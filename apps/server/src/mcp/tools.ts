import { type McpServerInstance, object, array, text, error, widget } from 'mcp-use/server';
import { z } from 'zod';
import type { Context } from 'hono';
import { logger } from '../logger.js';
import { loadConfig } from '../config.js';
import { PolitoApiError } from '../polito/client.js';
import { deleteUserCompletely } from '../db/users.js';
import {
  ToolAuthError,
  clientForUser,
  getPolitoAuthExtra,
  withPoliTo,
} from './auth-context.js';

/**
 * Wraps a tool's payload as an MCP result. Objects become structuredContent
 * directly; arrays are wrapped as `{ data: [...] }` (per the mcp-use `array`
 * helper); everything else is boxed as `{ value }`. Every result also carries a
 * pretty-printed JSON text block so non-widget clients see the data.
 */
function json(value: unknown) {
  if (Array.isArray(value)) return array(value);
  if (value !== null && typeof value === 'object') {
    return object(value as Record<string, unknown>);
  }
  return object({ value });
}

function makeError(message: string, kind?: string) {
  return error(kind ? `[${kind}] ${message}` : message);
}

function handleError(err: unknown, toolName: string) {
  // Network-level failure (Node fetch throws TypeError when the host is
  // unreachable or the connection is reset before an HTTP response arrives).
  if (
    err instanceof TypeError &&
    (err.message.toLowerCase().includes('fetch') ||
      err.message.toLowerCase().includes('network') ||
      err.message.toLowerCase().includes('connect'))
  ) {
    return makeError(
      'Network error: could not reach the PoliTO API. Check your connection and try again.',
      'network_error',
    );
  }
  if (err instanceof ToolAuthError) {
    if (err.code === 'not_authenticated') {
      if (err.sessionId) {
        const loginUrl = `${loadConfig().PUBLIC_ORIGIN}/connect?s=${err.sessionId}`;
        return text(
          `To use polito-mcp you need to connect your PoliTO account first.\n\nOpen this link in your browser, sign in with your PoliTO credentials, then come back here and ask again:\n\n${loginUrl}`,
        );
      }
      return makeError('Not authenticated. Please connect your PoliTO account.', 'not_authenticated');
    }
    if (err.code === 're_auth_required' || err.code === 'no_active_token') {
      return makeError(
        'Your PoliTO session has expired. Please re-authorize the polito-mcp connection in your MCP client.',
        're_auth_required',
      );
    }
  }
  if (err instanceof PolitoApiError) {
    logger.warn({ status: err.status, path: err.path }, `tool ${toolName} upstream error`);
    return makeError(
      `PoliTO API returned ${err.status}${err.politoMessage ? `: ${err.politoMessage}` : ''}`,
      'polito_error',
    );
  }
  logger.error({ err, toolName }, 'unexpected tool error');
  return makeError(err instanceof Error ? err.message : 'unknown error', 'internal');
}

/**
 * Error handler for widget-backed tools. When the caller isn't connected, hand
 * the /connect URL to the widget as a prop so it renders a "Connect your
 * account" card with a real clickable button (the link is then always visible,
 * regardless of how the model paraphrases its text reply). All other errors
 * fall through to the standard text handler.
 */
function widgetAuthError(err: unknown, toolName: string) {
  if (err instanceof ToolAuthError && err.code === 'not_authenticated' && err.sessionId) {
    const connectUrl = `${loadConfig().PUBLIC_ORIGIN}/connect?s=${err.sessionId}`;
    return widget({
      props: { connectUrl },
      output: text(
        `The student hasn't connected their PoliTO account yet. ` +
          `Tell them to open this sign-in link (show it verbatim): ${connectUrl}`,
      ),
    });
  }
  return handleError(err, toolName);
}

/** Weighted exam average (numeric grades only; lode counts as 30), or null. */
function weightedGradeAverage(
  grades: { grade: string; credits: number }[],
): { average: number | null; acquiredCredits: number } {
  let weighted = 0;
  let credits = 0;
  for (const g of grades) {
    const m = g.grade.match(/\d{1,2}/);
    const n = m ? parseInt(m[0], 10) : NaN;
    if (n >= 18 && n <= 31) {
      weighted += n * g.credits;
      credits += g.credits;
    }
  }
  return { average: credits > 0 ? weighted / credits : null, acquiredCredits: credits };
}

/** Registers every v1 MCP tool against the given mcp-use server instance. */
export function registerTools(server: McpServerInstance): void {
  // ---------- Current time (no auth needed) ----------

  server.tool(
    {
      name: 'get_current_datetime',
      title: 'Get current date and time',
      description:
        'Returns the current UTC date and time as an ISO string. Call this before any time-sensitive query such as "free rooms in 2 hours", "lectures this afternoon", or "upcoming deadlines this week".',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      return json({ utc: new Date().toISOString() });
    },
  );

  // ---------- Profile ----------

  server.tool(
    {
      name: 'get_profile',
      title: 'Get my PoliTO profile',
      description:
        'Returns the authenticated student profile: name, degree, current career, credits, averages, and on-time-exam points.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getStudent());
        return json(data);
      } catch (err) {
        return handleError(err, 'get_profile');
      }
    },
  );

  // ---------- Dashboard (aggregate widget) ----------

  server.tool(
    {
      name: 'open_dashboard',
      title: 'Open the student dashboard',
      description:
        'Opens the interactive polito-mcp dashboard: a single navigable view of the ' +
        'student\'s grades, today\'s lectures, upcoming deadlines, free classrooms and ' +
        'job offers, with an in-widget chat. Use whenever the student asks to "open the ' +
        'dashboard", "show my overview", "apri la dashboard", "panoramica", "la mia ' +
        'scrivania", or wants a single place to see everything at once.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      widget: { name: 'dashboard', invoking: 'Apertura dashboard…', invoked: 'Dashboard pronta' },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const today = new Date().toISOString().slice(0, 10);
        const from = new Date();
        const to = new Date(from.getTime() + 60 * 60_000);
        const timeFrom = from.toISOString().slice(11, 16);
        const timeTo = to.toISOString().slice(11, 16);
        const siteId = 'TO_CIT';

        // Resilient fan-out: one flaky endpoint degrades to empty, but an auth
        // failure (401) still propagates so withPoliTo can flag re_auth.
        const bundle = await withPoliTo(userId, async (c) => {
          const safe = async <X>(p: Promise<X>, fallback: X): Promise<X> => {
            try {
              return await p;
            } catch (err) {
              if (err instanceof PolitoApiError && err.isUnauthorized()) throw err;
              return fallback;
            }
          };
          const [profile, grades, lectures, deadlines, rooms, offers] = await Promise.all([
            safe(c.getStudent(), null),
            safe(c.getStudentGrades(), []),
            safe(c.getMyLectures(today, today), []),
            safe(c.getDeadlines(), []),
            safe(c.getFreeRooms(siteId, today, timeFrom, timeTo), []),
            safe(c.getJobOffers(), []),
          ]);
          return { profile, grades, lectures, deadlines, rooms, offers };
        });

        const { average } = weightedGradeAverage(bundle.grades);
        const name = bundle.profile?.firstName ?? 'studente';
        return widget({
          props: {
            profile: bundle.profile
              ? { firstName: bundle.profile.firstName, degreeName: bundle.profile.degreeName }
              : null,
            grades: bundle.grades,
            lectures: bundle.lectures,
            deadlines: bundle.deadlines,
            rooms: bundle.rooms,
            offers: bundle.offers,
            date: today,
            siteId,
            freeFrom: timeFrom,
            freeTo: timeTo,
          },
          output: text(
            `Dashboard di ${name}: ${bundle.lectures.length} lezioni oggi, ` +
              `${bundle.deadlines.length} scadenze, ${bundle.rooms.length} aule libere ora, ` +
              `${bundle.offers.length} offerte` +
              (average !== null ? `, media ${average.toFixed(2)}.` : '.'),
          ),
        });
      } catch (err) {
        return widgetAuthError(err, 'open_dashboard');
      }
    },
  );

  // ---------- Grades ----------

  server.tool(
    {
      name: 'get_grades',
      title: 'List exam grades',
      description: 'Lists all recorded exam grades for the authenticated student.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      widget: { name: 'grades-table', invoking: 'Caricamento voti…', invoked: 'Voti caricati' },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const grades = await withPoliTo(userId, (c) => c.getStudentGrades());
        const { average, acquiredCredits } = weightedGradeAverage(grades);
        return widget({
          props: { grades },
          output: text(
            `${grades.length} esami registrati, ${acquiredCredits} CFU` +
              (average !== null ? `, media ponderata ${average.toFixed(2)}.` : '.'),
          ),
        });
      } catch (err) {
        return widgetAuthError(err, 'get_grades');
      }
    },
  );

  // ---------- Provisional grades ----------

  server.tool(
    {
      name: 'get_provisional_grades',
      title: 'List provisional grades',
      description:
        'Lists provisional exam grades the student can still accept or reject, plus the available state codes.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getProvisionalGrades());
        return json(data);
      } catch (err) {
        return handleError(err, 'get_provisional_grades');
      }
    },
  );

  server.tool(
    {
      name: 'accept_provisional_grade',
      title: 'Accept a provisional grade',
      description: 'Accepts a provisional grade by id. Irreversible on PoliTO side.',
      schema: z.object({
        id: z.number().int().positive().describe('Provisional grade id (from get_provisional_grades).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        await withPoliTo(userId, (c) => c.acceptProvisionalGrade(id));
        return json({ accepted: true, id });
      } catch (err) {
        return handleError(err, 'accept_provisional_grade');
      }
    },
  );

  server.tool(
    {
      name: 'reject_provisional_grade',
      title: 'Reject a provisional grade',
      description: 'Rejects a provisional grade by id. Irreversible on PoliTO side.',
      schema: z.object({
        id: z.number().int().positive().describe('Provisional grade id (from get_provisional_grades).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        await withPoliTo(userId, (c) => c.rejectProvisionalGrade(id));
        return json({ rejected: true, id });
      } catch (err) {
        return handleError(err, 'reject_provisional_grade');
      }
    },
  );

  // ---------- Deadlines ----------

  server.tool(
    {
      name: 'list_deadlines',
      title: 'List academic deadlines',
      description:
        'Lists academic and administrative deadlines. Both bounds are optional and default to 7 days before/after today.',
      schema: z.object({
        fromDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Start date filter in YYYY-MM-DD format (inclusive). Defaults to 7 days before today.'),
        toDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('End date filter in YYYY-MM-DD format (inclusive). Defaults to 7 days after today.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      widget: {
        name: 'deadline-calendar',
        invoking: 'Caricamento scadenze…',
        invoked: 'Scadenze caricate',
      },
    },
    async ({ fromDate, toDate }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const deadlines = await withPoliTo(userId, (c) => c.getDeadlines(fromDate, toDate));
        const summary =
          deadlines.length === 0
            ? 'Nessuna scadenza nel periodo.'
            : `${deadlines.length} scadenze: ` +
              deadlines.map((d) => `${d.name} (${d.date.slice(0, 10)})`).join(', ') +
              '.';
        return widget({ props: { deadlines }, output: text(summary) });
      } catch (err) {
        return widgetAuthError(err, 'list_deadlines');
      }
    },
  );

  // ---------- Today's lectures ----------

  server.tool(
    {
      name: 'list_today_lectures',
      title: "List today's lectures",
      description:
        'Returns the lectures scheduled for the student today (UTC date), including time, place, and the related course.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      widget: { name: 'today-lectures', invoking: 'Caricamento lezioni…', invoked: 'Lezioni caricate' },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const today = new Date().toISOString().slice(0, 10);
        const lectures = await withPoliTo(userId, (c) => c.getMyLectures(today, today));
        const summary =
          lectures.length === 0
            ? 'Nessuna lezione in programma oggi.'
            : `${lectures.length} lezioni oggi: ` +
              lectures
                .map((l) => `${l.courseName} (${l.startsAt.slice(11, 16)})`)
                .join(', ') +
              '.';
        return widget({ props: { lectures, date: today }, output: text(summary) });
      } catch (err) {
        return widgetAuthError(err, 'list_today_lectures');
      }
    },
  );

  // ---------- Courses ----------

  server.tool(
    {
      name: 'list_courses',
      title: 'List enrolled courses',
      description: 'Lists all courses the student is currently enrolled in.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getCourses());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_courses');
      }
    },
  );

  server.tool(
    {
      name: 'get_course',
      title: 'Get course details',
      description: 'Returns details for one course (info, instructors, notices, files).',
      schema: z.object({
        id: z.number().int().positive().describe('Course id (from list_courses).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getCourse(id));
        return json(data);
      } catch (err) {
        return handleError(err, 'get_course');
      }
    },
  );

  // ---------- Messages ----------

  server.tool(
    {
      name: 'list_messages',
      title: 'List inbox messages',
      description: 'Lists messages from PoliTO (teachers, secretariat, exams, system events).',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getMessages());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_messages');
      }
    },
  );

  server.tool(
    {
      name: 'mark_message_read',
      title: 'Mark message as read',
      description: 'Marks a single message as read.',
      schema: z.object({
        id: z.number().int().positive().describe('Message id (from list_messages).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        await withPoliTo(userId, (c) => c.markMessageRead(id));
        return json({ markedRead: true, id });
      } catch (err) {
        return handleError(err, 'mark_message_read');
      }
    },
  );

  // ---------- Notifications ----------

  server.tool(
    {
      name: 'list_notifications',
      title: 'List push notifications',
      description: 'Lists in-app/push notifications delivered to the student.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getNotifications());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_notifications');
      }
    },
  );

  // ---------- Exams & bookings ----------

  server.tool(
    {
      name: 'list_exams',
      title: 'List exams',
      description: 'Lists exam appellations available to the student.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getExams());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_exams');
      }
    },
  );

  server.tool(
    {
      name: 'list_bookings',
      title: 'List active bookings',
      description: 'Lists bookings the student has made (exams, lectures, library, etc.).',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getBookings());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_bookings');
      }
    },
  );

  // ---------- Unread emails ----------

  server.tool(
    {
      name: 'get_unread_emails_count',
      title: 'Get unread emails count',
      description: 'Returns the badge count for the student PoliTO webmail.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getUnreadEmailsNumber());
        return json(data);
      } catch (err) {
        return handleError(err, 'get_unread_emails_count');
      }
    },
  );

  // ---------- Course content ----------

  server.tool(
    {
      name: 'list_course_notices',
      title: 'List course notices',
      description: 'Returns notices/announcements posted by the professor for a specific course.',
      schema: z.object({
        courseId: z.number().int().positive().describe('Course id (from list_courses).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ courseId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getCourseNotices(courseId));
        return json(data);
      } catch (err) {
        return handleError(err, 'list_course_notices');
      }
    },
  );

  server.tool(
    {
      name: 'list_course_files',
      title: 'List course files',
      description:
        'Returns the file/folder tree for a course. Directories contain nested files. Each file includes a download URL.',
      schema: z.object({
        courseId: z.number().int().positive().describe('Course id (from list_courses).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ courseId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getCourseFiles(courseId));
        return json(data);
      } catch (err) {
        return handleError(err, 'list_course_files');
      }
    },
  );

  server.tool(
    {
      name: 'list_course_videolectures',
      title: 'List course video lectures',
      description:
        'Returns recorded video lectures for a course, including title, duration, and streaming URL.',
      schema: z.object({
        courseId: z.number().int().positive().describe('Course id (from list_courses).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ courseId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getCourseVideolectures(courseId));
        return json(data);
      } catch (err) {
        return handleError(err, 'list_course_videolectures');
      }
    },
  );

  server.tool(
    {
      name: 'list_course_virtual_classrooms',
      title: 'List virtual classroom sessions',
      description:
        'Returns virtual classroom recordings or live sessions for a course. Pass live=true to get only ongoing live sessions.',
      schema: z.object({
        courseId: z.number().int().positive().describe('Course id (from list_courses).'),
        live: z
          .boolean()
          .optional()
          .describe('If true, return only currently-live sessions. Omit to return all.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ courseId, live }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getCourseVirtualClassrooms(courseId, live));
        return json(data);
      } catch (err) {
        return handleError(err, 'list_course_virtual_classrooms');
      }
    },
  );

  server.tool(
    {
      name: 'list_course_assignments',
      title: 'List submitted assignments',
      description: 'Lists assignments (elaborati) the student has submitted for a course.',
      schema: z.object({
        courseId: z.number().int().positive().describe('Course id (from list_courses).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ courseId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getCourseAssignments(courseId));
        return json(data);
      } catch (err) {
        return handleError(err, 'list_course_assignments');
      }
    },
  );

  server.tool(
    {
      name: 'get_next_lecture',
      title: 'Get next upcoming lecture',
      description: 'Returns the next scheduled lecture for a specific course.',
      schema: z.object({
        courseId: z.number().int().positive().describe('Course id (from list_courses).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ courseId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getNextLecture(courseId));
        return json(data);
      } catch (err) {
        return handleError(err, 'get_next_lecture');
      }
    },
  );

  server.tool(
    {
      name: 'list_lectures',
      title: 'List lectures in date range',
      description:
        'Returns all lectures in a date range. Defaults to 7 days before/after today if omitted.',
      schema: z.object({
        fromDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Start date YYYY-MM-DD (inclusive).'),
        toDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('End date YYYY-MM-DD (inclusive).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ fromDate, toDate }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getMyLectures(fromDate, toDate));
        return json(data);
      } catch (err) {
        return handleError(err, 'list_lectures');
      }
    },
  );

  // ---------- Exam booking ----------

  server.tool(
    {
      name: 'book_exam',
      title: 'Book an exam',
      description:
        'Books an exam session for the student. Get the exam id and courseShortcode from list_exams.',
      schema: z.object({
        examId: z.number().int().positive().describe('Exam id (from list_exams).'),
        courseShortcode: z.string().describe('Course shortcode, e.g. "01UDROV".'),
        questionId: z
          .number()
          .int()
          .optional()
          .describe('Id of the selected question option if the exam requires one.'),
        questionOption: z.number().int().optional().describe('Selected option index.'),
        requestReason: z
          .string()
          .optional()
          .describe('Reason string for requestable exams.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ examId, courseShortcode, questionId, questionOption, requestReason }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        await withPoliTo(userId, (c) =>
          c.bookExam(examId, { courseShortcode, questionId, questionOption, requestReason }),
        );
        return json({ booked: true, examId });
      } catch (err) {
        return handleError(err, 'book_exam');
      }
    },
  );

  server.tool(
    {
      name: 'cancel_exam_booking',
      title: 'Cancel an exam booking',
      description: "Cancels the student's booking for an exam session.",
      schema: z.object({
        examId: z.number().int().positive().describe('Exam id (from list_exams).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
    },
    async ({ examId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        await withPoliTo(userId, (c) => c.cancelExamBooking(examId));
        return json({ cancelled: true, examId });
      } catch (err) {
        return handleError(err, 'cancel_exam_booking');
      }
    },
  );

  // ---------- Announcements ----------

  server.tool(
    {
      name: 'list_announcements',
      title: 'List app announcements',
      description: 'Lists in-app announcements from PoliTO (onboarding tips, app news).',
      schema: z.object({
        onlyNew: z
          .boolean()
          .optional()
          .describe('If true, return only unseen announcements.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ onlyNew }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) =>
          c.getAnnouncements(onlyNew !== undefined ? { new: onlyNew } : undefined),
        );
        return json(data);
      } catch (err) {
        return handleError(err, 'list_announcements');
      }
    },
  );

  // ---------- News ----------

  server.tool(
    {
      name: 'list_news',
      title: 'List university news',
      description: 'Lists recent news items and events published by Politecnico di Torino.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getNews());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_news');
      }
    },
  );

  server.tool(
    {
      name: 'get_news_item',
      title: 'Get full news article',
      description: 'Returns the full HTML content and attachments for a news item.',
      schema: z.object({
        id: z.number().positive().describe('News item id (from list_news).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getNewsItem(id));
        return json(data);
      } catch (err) {
        return handleError(err, 'get_news_item');
      }
    },
  );

  // ---------- Job offers ----------

  server.tool(
    {
      name: 'list_job_offers',
      title: 'List internship and job offers',
      description:
        'Lists job/internship offers posted on the PoliTO career portal. AI can filter by location, contract type, or keyword.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      widget: { name: 'job-board', invoking: 'Caricamento offerte…', invoked: 'Offerte caricate' },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const offers = await withPoliTo(userId, (c) => c.getJobOffers());
        const summary =
          offers.length === 0
            ? 'Nessuna offerta disponibile.'
            : `${offers.length} offerte di lavoro/stage. Più recenti: ` +
              offers
                .slice(0, 5)
                .map((o) => `${o.title} — ${o.companyName} (${o.location})`)
                .join('; ') +
              '.';
        return widget({ props: { offers }, output: text(summary) });
      } catch (err) {
        return widgetAuthError(err, 'list_job_offers');
      }
    },
  );

  server.tool(
    {
      name: 'get_job_offer',
      title: 'Get job offer details',
      description: 'Returns full details for a specific job/internship offer.',
      schema: z.object({
        id: z.number().positive().describe('Job offer id (from list_job_offers).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getJobOffer(id));
        return json(data);
      } catch (err) {
        return handleError(err, 'get_job_offer');
      }
    },
  );

  // ---------- People ----------

  server.tool(
    {
      name: 'search_people',
      title: 'Search professors and staff',
      description:
        'Searches for professors or staff by name. Returns id, role, and picture. Use get_person for contact details.',
      schema: z.object({
        search: z.string().min(2).describe('Name fragment to search for (minimum 2 characters).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ search }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.searchPeople(search));
        return json(data);
      } catch (err) {
        return handleError(err, 'search_people');
      }
    },
  );

  server.tool(
    {
      name: 'get_person',
      title: 'Get professor or staff profile',
      description:
        'Returns full profile for a person: email, phone numbers, department, office URL, and courses taught.',
      schema: z.object({
        id: z.number().positive().describe('Person id (from search_people).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getPerson(id));
        return json(data);
      } catch (err) {
        return handleError(err, 'get_person');
      }
    },
  );

  // ---------- Campus / places ----------

  server.tool(
    {
      name: 'find_free_classrooms',
      title: 'Find free classrooms / aule libere',
      description:
        'Finds available classrooms at PoliTO at a given time. ' +
        'Use for any question like: "where are the free classrooms?", "aule libere", ' +
        '"find a room to study", "free rooms in 2 hours", "where can I study now?", ' +
        '"quali aule sono libere?", "c\'è un\'aula libera?". ' +
        'Handles time calculation internally — no need to call other tools first. ' +
        'Defaults to the main Politecnico campus (Cittadella Politecnica).',
      schema: z.object({
        minutesFromNow: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Minutes from now to start checking. 0 = right now, 120 = in 2 hours.'),
        durationMinutes: z
          .number()
          .int()
          .min(15)
          .default(60)
          .describe('How long the room needs to be free (minutes). Default 60.'),
        siteId: z
          .string()
          .optional()
          .describe(
            'Campus site id. Omit to use the main campus (TO_CIT). Use list_sites to see all campuses.',
          ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      widget: {
        name: 'free-rooms-grid',
        invoking: 'Ricerca aule libere…',
        invoked: 'Aule libere trovate',
      },
    },
    async ({ minutesFromNow = 0, durationMinutes = 60, siteId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const from = new Date(Date.now() + minutesFromNow * 60_000);
        const to = new Date(from.getTime() + durationMinutes * 60_000);
        const date = from.toISOString().slice(0, 10);
        const timeFrom = from.toISOString().slice(11, 16);
        const timeTo = to.toISOString().slice(11, 16);
        const targetSiteId = siteId ?? 'TO_CIT';
        const rooms = await withPoliTo(userId, (c) =>
          c.getFreeRooms(targetSiteId, date, timeFrom, timeTo),
        );
        const summary =
          rooms.length === 0
            ? `Nessuna aula libera a ${targetSiteId} tra le ${timeFrom} e le ${timeTo}.`
            : `${rooms.length} aule libere a ${targetSiteId} (${timeFrom}–${timeTo}): ` +
              rooms
                .slice(0, 10)
                .map((r) => r.name)
                .join(', ') +
              (rooms.length > 10 ? '…' : '.');
        return widget({
          props: { siteId: targetSiteId, freeFrom: timeFrom, freeTo: timeTo, date, rooms },
          output: text(summary),
        });
      } catch (err) {
        return widgetAuthError(err, 'find_free_classrooms');
      }
    },
  );

  server.tool(
    {
      name: 'list_sites',
      title: 'List campus sites',
      description: 'Lists PoliTO campus sites (e.g. main campus, Cittadella) with coordinates.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getSites());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_sites');
      }
    },
  );

  server.tool(
    {
      name: 'list_free_rooms',
      title: 'Find free rooms at a campus',
      description:
        'Lists classrooms/labs that are free at a given site within the requested time window. Get siteId from list_sites.',
      schema: z.object({
        siteId: z.string().describe('Site id from list_sites, e.g. "TO_CIT".'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date in YYYY-MM-DD format.'),
        timeFrom: z.string().regex(/^\d{2}:\d{2}$/).describe('Start time in HH:MM format, e.g. "09:00".'),
        timeTo: z.string().regex(/^\d{2}:\d{2}$/).describe('End time in HH:MM format, e.g. "11:00".'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ siteId, date, timeFrom, timeTo }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getFreeRooms(siteId, date, timeFrom, timeTo));
        return json(data);
      } catch (err) {
        return handleError(err, 'list_free_rooms');
      }
    },
  );

  server.tool(
    {
      name: 'search_places',
      title: 'Search rooms and buildings',
      description:
        'Searches for rooms, labs, or buildings by name. Can filter by category (e.g. AULA), site, building, or floor.',
      schema: z.object({
        search: z.string().optional().describe('Text fragment to match against place name.'),
        placeCategoryId: z
          .string()
          .optional()
          .describe('Category filter, e.g. "AULA" for classrooms.'),
        siteId: z.string().optional().describe('Limit to a specific campus site.'),
        buildingId: z.string().optional().describe('Limit to a specific building.'),
        floorId: z.string().optional().describe('Limit to a specific floor.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ search, placeCategoryId, siteId, buildingId, floorId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) =>
          c.searchPlaces({ search, placeCategoryId, siteId, buildingId, floorId }),
        );
        return json(data);
      } catch (err) {
        return handleError(err, 'search_places');
      }
    },
  );

  server.tool(
    {
      name: 'get_place',
      title: 'Get place details',
      description:
        'Returns full details for a room or building: capacity, floor, resources (projector, whiteboard, etc.).',
      schema: z.object({
        placeId: z.string().describe('Place id (from search_places).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ placeId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getPlace(placeId));
        return json(data);
      } catch (err) {
        return handleError(err, 'get_place');
      }
    },
  );

  // ---------- Course statistics ----------

  server.tool(
    {
      name: 'get_course_statistics',
      title: 'Get course pass-rate statistics',
      description:
        'Returns grade distribution, pass/fail counts, and average grade for a course. Useful for difficulty assessment.',
      schema: z.object({
        courseShortcode: z
          .string()
          .describe('Course shortcode, e.g. "01UDROV". Use list_courses to find it.'),
        year: z
          .string()
          .optional()
          .describe('Academic year, e.g. "2024". Defaults to the most recent.'),
        teacherId: z
          .string()
          .optional()
          .describe('Filter by a specific teacher id.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ courseShortcode, year, teacherId }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) =>
          c.getCourseStatistics(courseShortcode, { year, teacherId }),
        );
        return json(data);
      } catch (err) {
        return handleError(err, 'get_course_statistics');
      }
    },
  );

  // ---------- Surveys ----------

  server.tool(
    {
      name: 'list_surveys',
      title: 'List pending surveys',
      description:
        'Lists teaching-quality surveys assigned to the student, with completion status and deadlines.',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getSurveys());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_surveys');
      }
    },
  );

  // ---------- Tickets ----------

  server.tool(
    {
      name: 'list_tickets',
      title: 'List support tickets',
      description: "Lists the student's support tickets to the university secretariat.",
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getTickets());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_tickets');
      }
    },
  );

  server.tool(
    {
      name: 'get_ticket',
      title: 'Get ticket with replies',
      description: 'Returns a full support ticket including all agent and student replies.',
      schema: z.object({
        id: z.number().int().positive().describe('Ticket id (from list_tickets).'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getTicket(id));
        return json(data);
      } catch (err) {
        return handleError(err, 'get_ticket');
      }
    },
  );

  server.tool(
    {
      name: 'close_ticket',
      title: 'Close a support ticket',
      description: 'Marks a support ticket as closed.',
      schema: z.object({
        id: z.number().int().positive().describe('Ticket id (from list_tickets).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ id }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        await withPoliTo(userId, (c) => c.closeTicket(id));
        return json({ closed: true, id });
      } catch (err) {
        return handleError(err, 'close_ticket');
      }
    },
  );

  server.tool(
    {
      name: 'search_ticket_faqs',
      title: 'Search ticket FAQs',
      description:
        'Searches the secretariat FAQ for answers to common questions. Useful before opening a ticket.',
      schema: z.object({
        search: z.string().min(3).describe('Query string to search FAQs.'),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ search }, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.searchTicketFAQs(search));
        return json(data);
      } catch (err) {
        return handleError(err, 'search_ticket_faqs');
      }
    },
  );

  // ---------- Guides ----------

  server.tool(
    {
      name: 'list_guides',
      title: 'List student guides',
      description:
        'Lists official PoliTO student guides with structured sections (e.g. exam procedures, thesis rules).',
      schema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (_params, ctx) => {
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        const data = await withPoliTo(userId, (c) => c.getGuides());
        return json(data);
      } catch (err) {
        return handleError(err, 'list_guides');
      }
    },
  );

  // ---------- Account control ----------

  server.tool(
    {
      name: 'delete_my_account',
      title: 'Delete my polito-mcp account',
      description:
        'Revokes the upstream PoliTO bearer token and wipes all stored data for this account on this server.',
      schema: z.object({
        confirm: z.literal(true).describe('Set to true to confirm the irreversible deletion.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ confirm }, ctx) => {
      if (confirm !== true) {
        return makeError('Pass `confirm: true` to actually delete the account.', 'confirm_required');
      }
      try {
        const { userId } = getPolitoAuthExtra(ctx);
        // Best-effort upstream logout before deleting the local token.
        try {
          const client = clientForUser(userId);
          await client.logout();
        } catch (err) {
          logger.warn({ err }, 'Upstream logout failed during account deletion');
        }
        deleteUserCompletely(userId);
        return json({ deleted: true });
      } catch (err) {
        return handleError(err, 'delete_my_account');
      }
    },
  );
}
