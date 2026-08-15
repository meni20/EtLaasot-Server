import Attendee from './entities/attendee.entity';
import EventPairing from './entities/event-pairing.entity';
import AttendeeRepository from './attendee.repository';
import TraineeMedication from '../trainee-medication/entities/trainee-medication.entity';
import { Op } from 'sequelize';

describe('AttendeeRepository participant projections', () => {
  const repository = new AttendeeRepository();

  beforeEach(() => {
    jest.spyOn(Attendee, 'findAll').mockResolvedValue([]);
    jest.spyOn(EventPairing, 'findAll').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps allergies out of the shared participant projection', async () => {
    await repository.getStructuredParticipants('event-1');

    const attendeeQuery = jest.mocked(Attendee.findAll).mock.calls[0][0] as any;
    const userAttributes = attendeeQuery.include[0].attributes as string[];

    expect(userAttributes).not.toContain('allergies');
    expect(userAttributes).not.toContain('shirtSize');
    expect(userAttributes).not.toContain('gender');
    expect(attendeeQuery.include[0].include).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: TraineeMedication }),
      ]),
    );
  });

  it('selects gender only for the private assignment-email projection', async () => {
    await repository.getStructuredParticipants('event-1', {
      includeAssignmentGender: true,
    });

    const attendeeQuery = jest.mocked(Attendee.findAll).mock.calls[0][0] as any;
    const pairingQuery = jest.mocked(EventPairing.findAll).mock
      .calls[0][0] as any;

    expect(attendeeQuery.include[0].attributes).toContain('gender');
    expect(pairingQuery.include[0].attributes).toContain('gender');
    expect(pairingQuery.include[1].attributes).toContain('gender');
  });

  it('selects shirt size and allergies for the protected print projection', async () => {
    await repository.getStructuredParticipants('event-1', {
      includePrintProfile: true,
    });

    const attendeeQuery = jest.mocked(Attendee.findAll).mock.calls[0][0] as any;
    const pairingQuery = jest.mocked(EventPairing.findAll).mock
      .calls[0][0] as any;
    const attendeeUserAttributes = attendeeQuery.include[0]
      .attributes as string[];
    const mentorAttributes = pairingQuery.include[0].attributes as string[];
    const traineeAttributes = pairingQuery.include[1].attributes as string[];
    const expectedAttributes = [
      'id',
      'name',
      'shirtSize',
      'customShirtSize',
      'allergies',
    ];

    expect(attendeeUserAttributes).toEqual(expectedAttributes);
    expect(mentorAttributes).toEqual(expectedAttributes);
    expect(traineeAttributes).toEqual(expectedAttributes);

    const attendeeMedicationInclude = attendeeQuery.include[0].include.find(
      (include: any) => include.model === TraineeMedication,
    );
    const traineeMedicationInclude = pairingQuery.include[1].include.find(
      (include: any) => include.model === TraineeMedication,
    );

    expect(attendeeMedicationInclude).toEqual(
      expect.objectContaining({
        as: 'traineeMedications',
        where: { isActive: true },
        required: false,
      }),
    );
    expect(attendeeMedicationInclude.attributes).toEqual([
      'id',
      'medicationName',
      'dosage',
      'frequency',
      'schedule',
      'isActive',
    ]);
    expect(traineeMedicationInclude).toEqual(attendeeMedicationInclude);
    expect(pairingQuery.include[0].include).toBeUndefined();
  });
});

describe('AttendeeRepository event pairings', () => {
  const repository = new AttendeeRepository();

  const installPairingStore = () => {
    const rows: any[] = [];
    let nextId = 1;

    const findOne = jest
      .spyOn(EventPairing, 'findOne')
      .mockImplementation(async (options: any) => {
        const includeDeleted = options.paranoid === false;

        return (
          rows.find(
            (row) =>
              (includeDeleted || row.deletedAt === null) &&
              Object.entries(options.where).every(
                ([field, value]) => row[field] === value,
              ),
          ) ?? null
        );
      });
    const create = jest
      .spyOn(EventPairing, 'create')
      .mockImplementation(async (values: any) => {
        const row: any = {
          id: `pairing-${nextId++}`,
          ...values,
          deletedAt: null,
        };
        row.restore = jest.fn(async () => {
          row.deletedAt = null;
          return row;
        });
        row.reload = jest.fn(async () => row);
        rows.push(row);
        return row;
      });
    jest
      .spyOn(EventPairing, 'destroy')
      .mockImplementation(async (options: any) => {
        const row = rows.find(
          (candidate) =>
            candidate.id === options.where.id && candidate.deletedAt === null,
        );
        if (!row) return 0;

        row.deletedAt = new Date();
        return 1;
      });

    return {
      rows,
      create,
      findOne,
      activeRows: () => rows.filter((row) => row.deletedAt === null),
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows two mentors to pair with the same trainee in one event', async () => {
    const store = installPairingStore();
    const transaction = {} as any;

    const first = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      transaction,
    );
    const second = await repository.createPairing(
      'event-1',
      'mentor-2',
      'trainee-1',
      'branch-1',
      transaction,
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(store.activeRows()).toEqual([
      expect.objectContaining({ mentorId: 'mentor-1', traineeId: 'trainee-1' }),
      expect.objectContaining({ mentorId: 'mentor-2', traineeId: 'trainee-1' }),
    ]);
  });

  it('rejects pairing one mentor with two trainees in one event', async () => {
    const store = installPairingStore();
    const transaction = {} as any;

    await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      transaction,
    );
    const result = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-2',
      'branch-1',
      transaction,
    );

    expect(result).toBeNull();
    expect(store.activeRows()).toEqual([
      expect.objectContaining({ mentorId: 'mentor-1', traineeId: 'trainee-1' }),
    ]);
    expect(store.create).toHaveBeenCalledTimes(1);
  });

  it('returns the existing exact active pairing without creating a duplicate', async () => {
    const store = installPairingStore();
    const transaction = {} as any;

    const first = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      transaction,
    );
    const second = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      transaction,
    );

    expect(second).toBe(first);
    expect(store.activeRows()).toHaveLength(1);
    expect(store.create).toHaveBeenCalledTimes(1);
  });

  it('restores a soft-deleted exact pairing when pairing again', async () => {
    const store = installPairingStore();
    const transaction = {} as any;

    const first = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      transaction,
    );
    await repository.deletePairing(first!.id, transaction);
    const restored = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      transaction,
    );

    expect(restored).toBe(first);
    expect(first!.restore).toHaveBeenCalledWith({ transaction });
    expect(store.activeRows()).toHaveLength(1);
    expect(store.create).toHaveBeenCalledTimes(1);
  });

  it('keeps automatic pairing limited to the first mentor', async () => {
    jest.spyOn(EventPairing, 'findAll').mockResolvedValue([
      {
        eventId: 'event-1',
        mentorId: 'mentor-1',
        traineeId: 'trainee-1',
      } as EventPairing,
    ]);
    const create = jest.spyOn(EventPairing, 'create');

    const result = await repository.createPairingIfUsersUnpaired(
      'event-1',
      'mentor-2',
      'trainee-1',
      'branch-1',
      {} as any,
    );

    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('removes every pairing for a removed trainee or only the selected mentor', async () => {
    const destroy = jest.spyOn(EventPairing, 'destroy').mockResolvedValue(2);
    const transaction = {} as any;

    await repository.removePairingsForUsers('event-1', ['user-1'], transaction);

    const query = destroy.mock.calls[0][0] as any;
    expect(query.where.eventId).toBe('event-1');
    expect(query.where[Op.or]).toEqual([
      { mentorId: { [Op.in]: ['user-1'] } },
      { traineeId: { [Op.in]: ['user-1'] } },
    ]);
    expect(query.transaction).toBe(transaction);
  });

  it('deletes one manual pairing without touching the remaining pairings', async () => {
    const destroy = jest.spyOn(EventPairing, 'destroy').mockResolvedValue(1);
    const transaction = {} as any;

    await repository.deletePairing('pairing-1', transaction);

    expect(destroy).toHaveBeenCalledWith({
      where: { id: 'pairing-1' },
      transaction,
    });
  });
});

describe('EventPairing index contract', () => {
  it('keeps mentor uniqueness and trainee lookup non-unique for active rows', () => {
    const indexes =
      Reflect.getMetadata('sequelize:options', EventPairing.prototype)?.indexes ??
      [];
    const mentorIndex = indexes.find(
      (index) => index.name === 'event_pairing_mentor_active_unique',
    );
    const traineeIndex = indexes.find(
      (index) => index.name === 'idx_event_pairing_event_trainee_active',
    );

    expect(mentorIndex).toEqual(
      expect.objectContaining({
        unique: true,
        fields: ['eventId', 'mentorId'],
        where: { deletedAt: null },
      }),
    );
    expect(traineeIndex).toEqual(
      expect.objectContaining({
        fields: ['eventId', 'traineeId'],
        where: { deletedAt: null },
      }),
    );
    expect(traineeIndex?.unique).not.toBe(true);
    expect(
      indexes.some(
        (index) => index.name === 'event_pairing_trainee_active_unique',
      ),
    ).toBe(false);
  });
});
