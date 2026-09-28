import UserRepository from '../user/user.repository';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Op, Transaction } from 'sequelize';
import { validate } from 'class-validator';
import { AuthorizationService, AuthUser } from '../auth/authorization.service';
import {
  EVENT_AUDIENCES,
  EventAudience,
  eventAudienceWhere,
} from './event-audience';
import { CreateEventDto } from './dtos/event.dto';
import Event from './entities/event.entity';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import Attendee from '../attendee/entities/attendee.entity';
import VolunteerActivity from '../activity/entities/activity.entity';
import MentorAssignment from '../mentor-assignment/entities/mentor-assignment.entity';
import AttendeeService from '../attendee/attendee.service';
import {
  AttendanceIntent,
  AttendeeRsvpStatus,
} from '../attendee/attendee.constants';
import EventRepository from './event.repository';
import ActivityService from '../activity/activity.service';

const actor = (roles: number[], branchId = 'branch-a'): AuthUser => ({
  userId: 'actor',
  roles: roles.map((roleId) => ({ roleId, branchId })),
});
const tx = { LOCK: { UPDATE: 'UPDATE' } } as Transaction;
const transaction = jest.fn(async (run) => run(tx));
const auth = new AuthorizationService();
const users = [
  {
    id: 'actor',
    branchId: 'branch-a',
    isActive: true,
    userRoles: [{ roleId: 1, resourceId: 'branch-a' }],
  },
  {
    id: 'trainee',
    branchId: 'branch-a',
    isActive: true,
    userRoles: [{ roleId: 2, resourceId: 'branch-a' }],
  },
];
const eventFor = (audience: EventAudience = 'ALL') => ({
  id: 'event',
  branchId: 'branch-a',
  audience,
});

describe('Event audience authorization and query matrix', () => {
  afterEach(() => jest.restoreAllMocks());
  const cases: [number[], EventAudience[]][] = [
    [[1], ['ALL', 'VOLUNTEERS']],
    [[2], ['ALL', 'TRAINEES']],
    [[1, 2], [...EVENT_AUDIENCES]],
    [[10000], [...EVENT_AUDIENCES]],
    [[10001], [...EVENT_AUDIENCES]],
  ];
  it.each(cases)(
    'role(s) %j have precisely the expected audiences',
    (roles, allowed) => {
      for (const audience of EVENT_AUDIENCES) {
        const check = () =>
          auth.assertEventAccess(actor(roles), eventFor(audience));
        if (allowed.includes(audience)) expect(check).not.toThrow();
        else expect(check).toThrow(ForbiddenException);
      }
    },
  );
  it.each([[1], [2], [1, 2], [10000]])(
    'does not weaken branch isolation for %j',
    (...roles) => {
      for (const audience of EVENT_AUDIENCES)
        expect(() =>
          auth.assertEventAccess(actor(roles, 'other'), eventFor(audience)),
        ).toThrow(ForbiddenException);
    },
  );
  it('does not use a participant or admin role from another branch', () => {
    const mixed = {
      roles: [
        { roleId: 2, branchId: 'branch-a' },
        { roleId: 1, branchId: 'other' },
        { roleId: 10000, branchId: 'other' },
      ],
    };
    expect(() => auth.assertEventAccess(mixed, eventFor('VOLUNTEERS'))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      auth.assertEventAccess(actor([10001], 'other'), eventFor('TRAINEES')),
    ).not.toThrow();
  });
  it('supports resourceId role mappings and fails closed without a requested scope', () => {
    expect(() =>
      auth.assertEventAccess(
        { roles: [{ roleId: 1, resourceId: 'branch-a' }] },
        eventFor('VOLUNTEERS'),
      ),
    ).not.toThrow();
    expect(eventAudienceWhere(actor([1]))).toEqual({ id: { [Op.in]: [] } });
  });
  it.each(cases)(
    'filters all list queries before their limits for roles %j',
    async (roles, allowed) => {
      const findAll = jest.spyOn(Event, 'findAll').mockResolvedValue([]);
      const repository = new EventRepository(auth);
      await repository.findAll('branch-a', actor(roles));
      await repository.getUpcomingByBranch('branch-a', 5, actor(roles));
      await repository.getEventsByBranchAndDateRange(
        'branch-a',
        new Date(),
        new Date(),
        actor(roles),
      );
      for (const [options] of findAll.mock.calls) {
        expect(options?.where).toMatchObject({ branchId: 'branch-a' });
        if (!roles.includes(10001))
          expect(options?.where).toMatchObject({
            audience: { [Op.in]: allowed },
          });
        expect(options?.limit).toBeGreaterThan(0);
      }
    },
  );
  it.each([undefined, 'ALL', 'VOLUNTEERS', 'TRAINEES', null, '', 'PUBLIC'])(
    'validates audience %s without silently defaulting invalid input',
    async (audience) => {
      const dto = Object.assign(new CreateEventDto(), {
        name: 'event',
        description: '',
        address: '',
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-10-01T01:00:00Z',
        audience,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'audience')).toBe(
        audience !== undefined &&
          !EVENT_AUDIENCES.includes(audience as EventAudience),
      );
    },
  );
});

describe('Audience enforcement at participant mutation/read boundaries', () => {
  let event: ReturnType<typeof eventFor>;
  let repository: any;
  let service: AttendeeService;
  beforeEach(() => {
    event = eventFor();
    repository = {
      createAttendee: jest.fn().mockResolvedValue({ id: 'attendee' }),
      createAndConfirm: jest.fn().mockResolvedValue({ id: 'attendee' }),
      updateRsvp: jest.fn().mockResolvedValue([1]),
      findById: jest.fn().mockResolvedValue({
        id: 'attendee',
        eventId: 'event',
        userId: 'actor',
      }),
      ensureAttendee: jest.fn(),
      removeAttendee: jest.fn(),
      removePairingsForUsers: jest.fn(),
      getStructuredParticipants: jest
        .fn()
        .mockResolvedValue({ attendees: [], pairings: [] }),
      findAttendeeByUserEvent: jest.fn().mockResolvedValue({ id: 'attendee' }),
      createPairing: jest.fn().mockResolvedValue({ id: 'pair' }),
      createPairingIfUsersUnpaired: jest.fn(),
    };
    service = new AttendeeService(repository, { transaction } as any, auth);
    jest
      .spyOn(Event, 'findByPk')
      .mockImplementation(async () => event as Event);
    jest.spyOn(User, 'findAll').mockImplementation(async (options: any) => {
      const ids = options?.where?.id?.[Op.in] ?? options?.where?.id;
      return users.filter((u) => !ids || ids.includes(u.id)) as User[];
    });
    jest
      .spyOn(User, 'findOne')
      .mockImplementation(
        async (options: any) =>
          users.find((user) => user.id === options?.where?.id) as User,
      );
    jest.spyOn(UserRole, 'findOne').mockResolvedValue({} as UserRole);
    jest.spyOn(MentorAssignment, 'findOne').mockResolvedValue(null);
    transaction.mockClear();
  });
  afterEach(() => jest.restoreAllMocks());
  it.each(['join', 'intent', 'rsvp', 'participants'])(
    'rejects direct %s bypass attempts before writes/reads',
    async (route) => {
      event.audience = 'TRAINEES';
      const call =
        route === 'join'
          ? service.joinEvent(
              'actor',
              'event',
              AttendeeRsvpStatus.CONFIRMED,
              actor([1]),
            )
          : route === 'intent'
            ? service.updateAttendanceIntent(
                'event',
                AttendanceIntent.VOLUNTEER_ONLY,
                actor([1]),
              )
            : route === 'rsvp'
              ? service.updateRsvp(
                  'attendee',
                  AttendeeRsvpStatus.CONFIRMED,
                  actor([1]),
                )
              : service.getParticipantsByEvent('event', actor([1]));
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);
      for (const method of [
        'createAndConfirm',
        'ensureAttendee',
        'updateRsvp',
        'getStructuredParticipants',
      ])
        expect(repository[method]).not.toHaveBeenCalled();
    },
  );
  it.each(EVENT_AUDIENCES)(
    'permits a matching join and uses the event lock for %s',
    async (audience) => {
      event.audience = audience;
      const role = audience === 'TRAINEES' ? 2 : 1;
      const id = role === 2 ? 'trainee' : 'actor';
      await service.joinEvent(id, 'event', AttendeeRsvpStatus.CONFIRMED, {
        ...actor([role]),
        userId: id,
      });
      expect(Event.findByPk).toHaveBeenCalledWith('event', {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      expect(repository.createAndConfirm).toHaveBeenCalledWith(
        id,
        'event',
        AttendeeRsvpStatus.CONFIRMED,
        tx,
      );
    },
  );
  it('preserves ALL attendance and existing participant response', async () => {
    await service.updateAttendanceIntent(
      'event',
      AttendanceIntent.VOLUNTEER_ONLY,
      actor([1]),
    );
    expect(repository.ensureAttendee).toHaveBeenCalledWith(
      'actor',
      'event',
      tx,
    );
    expect(repository.getStructuredParticipants).toHaveBeenCalledWith('event');
  });
  it('uses trainee intent for a dual-role user on a TRAINEES event', async () => {
    event.audience = 'TRAINEES';
    await service.updateAttendanceIntent(
      'event',
      AttendanceIntent.TRAINEE_ONLY,
      { ...actor([1, 2]), userId: 'trainee' },
    );
    expect(repository.ensureAttendee).toHaveBeenCalledWith(
      'trainee',
      'event',
      tx,
    );
  });
  it('admin add validates the participant, not the administrator audience', async () => {
    event.audience = 'VOLUNTEERS';
    await expect(
      service.addAttendee('trainee', 'event', actor([10000])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createAttendee).not.toHaveBeenCalled();
    await service.addAttendee('actor', 'event', actor([10000]));
    expect(repository.createAttendee).toHaveBeenCalledWith(
      'actor',
      'event',
      tx,
    );
  });
  it('admin ALL add and manual pairing remain supported', async () => {
    await service.addAttendee('trainee', 'event', actor([10000]));
    await service.createManualPairing(
      'event',
      'actor',
      'trainee',
      actor([10000]),
    );
    expect(repository.createPairing).toHaveBeenCalled();
  });
  it.each(['VOLUNTEERS', 'TRAINEES'] as EventAudience[])(
    'manual and automatic pairings cannot bypass %s',
    async (audience) => {
      event.audience = audience;
      await expect(
        service.createManualPairing(
          'event',
          'actor',
          'trainee',
          actor([10000]),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await (service as any).tryCreateAssignedPairingIfCounterpartAttending(
        'event',
        event,
        'actor',
        'trainee',
        'actor',
        tx,
      );
      expect(repository.createPairing).not.toHaveBeenCalled();
      expect(repository.createPairingIfUsersUnpaired).not.toHaveBeenCalled();
    },
  );
  it.each(
    EVENT_AUDIENCES.flatMap((audience) =>
      [[1], [2], [1, 2]].map((roles) => ({ audience, roles })),
    ),
  )(
    'enforces join, RSVP, intent and reads for $roles / $audience',
    async ({ audience, roles }) => {
      event.audience = audience;
      const currentActor = actor(roles);
      (User.findAll as jest.Mock).mockResolvedValue([
        {
          ...users[0],
          userRoles: roles.map((roleId) => ({
            roleId,
            resourceId: 'branch-a',
          })),
        },
      ]);
      const eligible =
        audience === 'ALL' || roles.includes(audience === 'VOLUNTEERS' ? 1 : 2);
      const intent =
        roles.includes(2) && (audience === 'TRAINEES' || !roles.includes(1))
          ? AttendanceIntent.TRAINEE_ONLY
          : AttendanceIntent.VOLUNTEER_ONLY;
      const operations = [
        () =>
          service.joinEvent(
            'actor',
            'event',
            AttendeeRsvpStatus.CONFIRMED,
            currentActor,
          ),
        () =>
          service.updateRsvp(
            'attendee',
            AttendeeRsvpStatus.CONFIRMED,
            currentActor,
          ),
        () => service.updateAttendanceIntent('event', intent, currentActor),
        () => service.getParticipantsByEvent('event', currentActor),
      ];
      for (const operation of operations) {
        if (eligible) await expect(operation()).resolves.toBeDefined();
        else
          await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
      }
    },
  );
  it('preserves automatic ALL pairings when both users attend', async () => {
    await (service as any).tryCreateAssignedPairingIfCounterpartAttending(
      'event',
      event,
      'actor',
      'trainee',
      'actor',
      tx,
    );
    expect(repository.createPairingIfUsersUnpaired).toHaveBeenCalledWith(
      'event',
      'actor',
      'trainee',
      'branch-a',
      tx,
    );
  });
  it.each(['VOLUNTEERS', 'TRAINEES'] as EventAudience[])(
    'allows eligible dual-role participants in manual and automatic %s pairings',
    async (audience) => {
      event.audience = audience;
      (User.findAll as jest.Mock).mockResolvedValue(
        users.map((user) => ({
          ...user,
          userRoles: [1, 2].map((roleId) => ({
            roleId,
            resourceId: 'branch-a',
          })),
        })),
      );
      await service.createManualPairing(
        'event',
        'actor',
        'trainee',
        actor([10000]),
      );
      await (service as any).tryCreateAssignedPairingIfCounterpartAttending(
        'event',
        event,
        'actor',
        'trainee',
        'actor',
        tx,
      );
      expect(repository.createPairing).toHaveBeenCalled();
      expect(repository.createPairingIfUsersUnpaired).toHaveBeenCalled();
    },
  );
  it('filters assignment recipients and incompatible counterparts', async () => {
    event.audience = 'VOLUNTEERS';
    repository.getStructuredParticipants.mockResolvedValue({
      attendees: users.map((user) => ({ userId: user.id, user })),
      pairings: [
        {
          mentorId: 'actor',
          traineeId: 'trainee',
          mentor: users[0],
          trainee: users[1],
        },
      ],
    });
    const recipients = await service.getEventAssignmentRecipients('event');
    expect(recipients.map((r) => r.userId)).toEqual(['actor']);
    expect(recipients[0].assignments).toEqual([]);
  });
});

describe('Audience edit conflicts and activity privacy', () => {
  beforeEach(() => {
    jest.spyOn(User, 'findAll').mockResolvedValue(users as User[]);
    jest
      .spyOn(Attendee, 'findAll')
      .mockResolvedValue([
        { userId: 'actor' },
        { userId: 'trainee' },
      ] as Attendee[]);
    jest.spyOn(VolunteerActivity, 'findAll').mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());
  it.each(['VOLUNTEERS', 'TRAINEES'] as EventAudience[])(
    'rejects narrowing to %s with exact participant counts',
    async (audience) => {
      try {
        await auth.assertAudienceChangeAllowed(
          eventFor() as Event,
          { audience, branchId: 'branch-a' },
          tx,
        );
        throw new Error('Expected conflict');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          code: 'EVENT_AUDIENCE_CONFLICT',
          participantCount: 1,
          activeActivityCount: 0,
        });
      }
    },
  );
  it('blocks incompatible active activities even without attendees', async () => {
    (Attendee.findAll as jest.Mock).mockResolvedValue([]);
    (VolunteerActivity.findAll as jest.Mock).mockResolvedValue([
      { id: 'activity', volunteerId: 'actor', traineeId: 'trainee' },
    ]);
    await expect(
      auth.assertAudienceChangeAllowed(
        eventFor() as Event,
        { audience: 'VOLUNTEERS', branchId: 'branch-a' },
        tx,
      ),
    ).rejects.toMatchObject({
      response: { participantCount: 0, activeActivityCount: 1 },
    });
  });
  it('allows an empty audience change and widening to ALL without deleting anything', async () => {
    (Attendee.findAll as jest.Mock).mockResolvedValue([]);
    await auth.assertAudienceChangeAllowed(
      eventFor() as Event,
      { audience: 'VOLUNTEERS', branchId: 'branch-a' },
      tx,
    );
    await auth.assertAudienceChangeAllowed(
      eventFor('VOLUNTEERS') as Event,
      { audience: 'ALL', branchId: 'branch-a' },
      tx,
    );
  });
  it('redacts restricted event metadata while preserving activity time/history', () => {
    const service = new ActivityService({} as any, {} as any, {} as any, auth);
    const activity = {
      id: 'activity',
      eventId: 'event',
      event: { ...eventFor('TRAINEES'), name: 'secret' },
      startTime: new Date(),
      endTime: null,
      status: 'ACTIVE',
      toJSON() {
        return { volunteerId: 'actor', traineeId: 'trainee' };
      },
    };
    const response = (service as any).toActivityResponse(activity, actor([1]));
    expect(response).toMatchObject({
      id: 'activity',
      eventId: null,
      event: null,
      status: 'ACTIVE',
    });
    expect(
      (service as any).toActivityResponse(activity, actor([10000])).event.name,
    ).toBe('secret');
  });
});

describe('Locked audience edits and activity creation', () => {
  const originalEventSequelize = Event.sequelize;
  const originalActivitySequelize = VolunteerActivity.sequelize;
  beforeEach(() => {
    Object.defineProperty(Event, 'sequelize', {
      configurable: true,
      writable: true,
      value: { transaction },
    });
    Object.defineProperty(VolunteerActivity, 'sequelize', {
      configurable: true,
      writable: true,
      value: { transaction },
    });
    jest.spyOn(User, 'findAll').mockResolvedValue(users as User[]);
    jest
      .spyOn(Attendee, 'findAll')
      .mockResolvedValue([{ userId: 'trainee' }] as Attendee[]);
    jest.spyOn(VolunteerActivity, 'findAll').mockResolvedValue([]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Event, 'sequelize', {
      configurable: true,
      writable: true,
      value: originalEventSequelize,
    });
    Object.defineProperty(VolunteerActivity, 'sequelize', {
      configurable: true,
      writable: true,
      value: originalActivitySequelize,
    });
  });
  it('keeps the saved audience when an older client omits it', async () => {
    const event = { ...eventFor('TRAINEES'), update: jest.fn() };
    jest.spyOn(Event, 'findByPk').mockResolvedValue(event as any);
    await new EventRepository(auth).updateEvent('event', { name: 'Renamed' });
    expect(event.update).toHaveBeenCalledWith(
      { name: 'Renamed', audience: 'TRAINEES' },
      { transaction: tx },
    );
  });
  it('rejects the entire edit before saving incompatible audience or other fields', async () => {
    const event = { ...eventFor(), update: jest.fn() };
    jest.spyOn(Event, 'findByPk').mockResolvedValue(event as any);
    await expect(
      new EventRepository(auth).updateEvent('event', {
        audience: 'VOLUNTEERS',
        name: 'Unsaved',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(event.update).not.toHaveBeenCalled();
  });
  it.each(EVENT_AUDIENCES)(
    'validates both participants before creating an activity for %s',
    async (audience) => {
      const event = eventFor(audience);
      jest.spyOn(Event, 'findByPk').mockResolvedValue(event as Event);
      const activity = {
        id: 'activity',
        event,
        eventId: 'event',
        startTime: new Date(),
        toJSON: () => ({}),
      };
      const repository = {
        findActiveByVolunteer: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(activity),
        findById: jest.fn().mockResolvedValue(activity),
      };
      const service = new ActivityService(
        repository as any,
        { findById: async (id) => users.find((u) => u.id === id) } as any,
        { findById: async () => event } as any,
        auth,
      );
      const result = service.startActivity(actor([1]) as any, {
        eventId: 'event',
        traineeId: 'trainee',
      });
      if (audience === 'ALL') {
        await expect(result).resolves.toMatchObject({ id: 'activity' });
        expect(repository.create).toHaveBeenCalledWith(
          expect.objectContaining({ eventId: 'event', branchId: 'branch-a' }),
          tx,
        );
      } else {
        await expect(result).rejects.toBeInstanceOf(ForbiddenException);
        expect(repository.create).not.toHaveBeenCalled();
      }
    },
  );
});

describe('Activity trainee list eligibility data', () => {
  afterEach(() => jest.restoreAllMocks());
  it('preserves all roles for selected trainees without changing branch/status/limit', async () => {
    const trainee = { id: 'dual', toJSON: () => ({ id: 'dual', name: 'Dual role trainee' }) };
    jest.spyOn(User, 'findAll').mockResolvedValue([trainee] as any);
    const roles = [1, 2].map((roleId) => ({
      userId: 'dual',
      roleId,
      resourceId: 'branch-a',
    }));
    jest.spyOn(UserRole, 'findAll').mockResolvedValue(roles as UserRole[]);
    const result = await new UserRepository().getAllTrainees('branch-a');
    expect(User.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branchId: 'branch-a', isActive: true },
        limit: 500,
      }),
    );
    expect(UserRole.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { [Op.in]: ['dual'] } } }),
    );
    expect(result).toEqual([{ id: 'dual', name: 'Dual role trainee', userRoles: roles }]);
  });
});
