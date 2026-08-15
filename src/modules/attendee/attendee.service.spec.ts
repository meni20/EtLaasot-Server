import { ForbiddenException } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import Event from '../event/entities/event.entity';
import AttendeeRepository from './attendee.repository';
import AttendeeService from './attendee.service';

describe('AttendeeService printable participants', () => {
  const getStructuredParticipants = jest.fn();
  const repository = {
    getStructuredParticipants,
  } as unknown as AttendeeRepository;
  const service = new AttendeeService(repository, {} as Sequelize);

  beforeEach(() => {
    getStructuredParticipants.mockReset();
    getStructuredParticipants.mockResolvedValue({
      attendees: [],
      pairings: [],
    });
    jest.spyOn(Event, 'findByPk').mockResolvedValue({
      branchId: 'branch-1',
    } as Event);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the regular participant projection for the shared endpoint', async () => {
    await service.getParticipantsByEvent('event-1', {
      roles: [{ roleId: AUTH_ROLES.VOLUNTEER.id, branchId: 'branch-1' }],
    });

    expect(getStructuredParticipants).toHaveBeenCalledWith('event-1');
  });

  it('uses the private print projection for an authorized branch admin', async () => {
    await service.getPrintableParticipantsByEvent('event-1', {
      roles: [{ roleId: AUTH_ROLES.BRANCH_ADMIN.id, branchId: 'branch-1' }],
    });

    expect(getStructuredParticipants).toHaveBeenCalledWith('event-1', {
      includePrintProfile: true,
    });
  });

  it('rejects non-admin users before loading private print fields', async () => {
    await expect(
      service.getPrintableParticipantsByEvent('event-1', {
        roles: [{ roleId: AUTH_ROLES.VOLUNTEER.id, branchId: 'branch-1' }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(getStructuredParticipants).not.toHaveBeenCalled();
  });

  it('creates one role-aware recipient per registered attendee', async () => {
    getStructuredParticipants.mockResolvedValue({
      attendees: [
        {
          userId: 'mentor-1',
          rsvpStatus: 'confirmed',
          user: {
            id: 'mentor-1',
            name: 'חונכת',
            email: 'mentor@example.com',
            gender: 'female',
            userRoles: [{ roleId: AUTH_ROLES.VOLUNTEER.id }],
          },
        },
        {
          userId: 'mentor-2',
          rsvpStatus: 'confirmed',
          user: {
            id: 'mentor-2',
            name: 'חונך נוסף',
            email: 'mentor2@example.com',
            gender: 'male',
            userRoles: [{ roleId: AUTH_ROLES.VOLUNTEER.id }],
          },
        },
        {
          userId: 'trainee-1',
          rsvpStatus: 'confirmed',
          user: {
            id: 'trainee-1',
            name: 'חניך',
            email: 'trainee@example.com',
            gender: 'male',
            userRoles: [{ roleId: AUTH_ROLES.TRAINEE.id }],
          },
        },
        {
          userId: 'trainee-2',
          rsvpStatus: 'confirmed',
          user: {
            id: 'trainee-2',
            name: 'חניכה ללא שיבוץ',
            email: null,
            gender: null,
            userRoles: [{ roleId: AUTH_ROLES.TRAINEE.id }],
          },
        },
        {
          userId: 'not-attending',
          rsvpStatus: 'declined',
          user: {
            id: 'not-attending',
            name: 'לא מגיע',
            email: 'declined@example.com',
            userRoles: [{ roleId: AUTH_ROLES.TRAINEE.id }],
          },
        },
      ],
      pairings: [
        {
          mentorId: 'mentor-1',
          traineeId: 'trainee-1',
          mentor: { name: 'חונכת', gender: 'female' },
          trainee: { name: 'חניך', gender: 'male' },
        },
        {
          mentorId: 'mentor-2',
          traineeId: 'trainee-1',
          mentor: { name: 'חונך נוסף', gender: 'male' },
          trainee: { name: 'חניך', gender: 'male' },
        },
      ],
    });

    const recipients = await service.getEventAssignmentRecipients('event-1');

    expect(getStructuredParticipants).toHaveBeenCalledWith('event-1', {
      includeAssignmentGender: true,
    });
    expect(recipients).toHaveLength(4);
    expect(
      recipients.filter((recipient) => recipient.userId === 'trainee-1'),
    ).toEqual([
      expect.objectContaining({
        role: 'trainee',
        gender: 'male',
        assignments: [
          { name: 'חונכת', gender: 'female' },
          { name: 'חונך נוסף', gender: 'male' },
        ],
      }),
    ]);
    expect(recipients).toContainEqual(
      expect.objectContaining({
        userId: 'trainee-2',
        role: 'trainee',
        email: null,
        assignments: [],
      }),
    );
    expect(recipients).toContainEqual(
      expect.objectContaining({
        userId: 'mentor-1',
        role: 'mentor',
        assignments: [{ name: 'חניך', gender: 'male' }],
      }),
    );
    expect(
      recipients.some((recipient) => recipient.userId === 'not-attending'),
    ).toBe(false);
  });
});
