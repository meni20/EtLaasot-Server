import EventService from './event.service';
import Event from './entities/event.entity';
import type { EventAssignmentRecipient } from '../attendee/attendee.service';

describe('EventService assignment email wording', () => {
  const eventRepository = { findById: jest.fn() };
  const attendeeService = { getEventAssignmentRecipients: jest.fn() };
  const emailService = { sendEmail: jest.fn() };
  const service = new EventService(
    eventRepository as any,
    attendeeService as any,
    {} as any,
    {} as any,
    {} as any,
    emailService as any,
  );
  const event = {
    name: 'אירוע בדיקה',
    startDate: new Date('2026-08-13T16:00:00.000Z'),
    address: 'בת ים',
  } as Event;

  const buildEmail = (recipient: Partial<EventAssignmentRecipient>) =>
    (service as any).buildAssignmentEmail(event, {
      userId: 'mentor-1',
      name: 'שם החונך',
      email: 'mentor@example.com',
      gender: null,
      role: 'mentor',
      assignments: [{ name: 'שם החניך', gender: null }],
      ...recipient,
    }) as { text: string; html: string };

  it.each([
    {
      label: 'male mentor and male trainee',
      gender: 'male',
      assignmentGender: 'male',
      registration: 'אתה רשום כמשתתף באירוע',
      assignment: 'החניך המשובץ אליך: שם החניך',
    },
    {
      label: 'male mentor and female trainee',
      gender: 'male',
      assignmentGender: 'female',
      registration: 'אתה רשום כמשתתף באירוע',
      assignment: 'החניכה המשובצת אליך: שם החניך',
    },
    {
      label: 'female mentor and male trainee',
      gender: 'female',
      assignmentGender: 'male',
      registration: 'את רשומה כמשתתפת באירוע',
      assignment: 'החניך המשובץ אלייך: שם החניך',
    },
    {
      label: 'female mentor and female trainee',
      gender: 'female',
      assignmentGender: 'female',
      registration: 'את רשומה כמשתתפת באירוע',
      assignment: 'החניכה המשובצת אלייך: שם החניך',
    },
  ])('$label', ({ gender, assignmentGender, registration, assignment }) => {
    const email = buildEmail({
      gender: gender as 'male' | 'female',
      assignments: [
        {
          name: 'שם החניך',
          gender: assignmentGender as 'male' | 'female',
        },
      ],
    });

    expect(email.text).toContain(registration);
    expect(email.text).toContain(assignment);
    expect(email.html).toContain(registration);
    expect(email.html).toContain(assignment);
  });

  it('uses neutral wording when gender is missing', () => {
    const email = buildEmail({ gender: null });

    expect(email.text).toContain('נרשמת לאירוע');
    expect(email.text).toContain('השיבוץ שלך באירוע: שם החניך');
    expect(email.html).toContain('נרשמת לאירוע');
    expect(email.html).toContain('השיבוץ שלך באירוע: שם החניך');
    expect(email.text).not.toContain('male');
    expect(email.text).not.toContain('female');
    expect(email.html).not.toContain('male');
    expect(email.html).not.toContain('female');
  });

  it('builds one trainee email with multiple mentor names', () => {
    const email = buildEmail({
      role: 'trainee',
      gender: 'male',
      assignments: [
        { name: 'חונך א', gender: 'male' },
        { name: 'חונכת ב', gender: 'female' },
      ],
    });

    const assignment = 'החונכים המשובצים אליך: חונך א, חונכת ב';
    expect(email.text).toContain(assignment);
    expect(email.html).toContain(assignment);
  });

  it('uses the trainee mentor wording for one paired mentor', () => {
    const email = buildEmail({
      role: 'trainee',
      gender: 'female',
      assignments: [{ name: 'שם החונך', gender: 'male' }],
    });

    expect(email.text).toContain('החונך המשובץ אלייך: שם החונך');
    expect(email.html).toContain('החונך המשובץ אלייך: שם החונך');
  });

  it.each(['mentor', 'trainee'] as const)(
    'uses a simple confirmation for an unpaired %s',
    (role) => {
      const email = buildEmail({ role, assignments: [] });

      expect(email.text).toContain('מחכים לראותך!');
      expect(email.html).toContain('מחכים לראותך!');
    },
  );

  it('sends once per recipient and skips a registered attendee without email', async () => {
    eventRepository.findById.mockResolvedValue(event);
    attendeeService.getEventAssignmentRecipients.mockResolvedValue([
      {
        userId: 'mentor-1',
        name: 'חונך',
        email: 'mentor@example.com',
        gender: 'male',
        role: 'mentor',
        assignments: [],
      },
      {
        userId: 'trainee-1',
        name: 'חניך',
        email: 'trainee@example.com',
        gender: 'male',
        role: 'trainee',
        assignments: [
          { name: 'חונך א', gender: 'male' },
          { name: 'חונך ב', gender: 'male' },
        ],
      },
      {
        userId: 'trainee-2',
        name: 'ללא אימייל',
        email: null,
        gender: null,
        role: 'trainee',
        assignments: [],
      },
    ]);
    emailService.sendEmail.mockResolvedValue(undefined);

    const result = await service.sendEventAssignments('event-1');

    expect(emailService.sendEmail).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      totalRegisteredAttendees: 3,
      totalAttendingMentors: 1,
      totalAttendingTrainees: 2,
      sentCount: 2,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(result.skipped).toEqual([
      expect.objectContaining({ userId: 'trainee-2', reason: 'missing_email' }),
    ]);
  });
});
