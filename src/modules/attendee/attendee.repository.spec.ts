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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds another mentor without deleting existing trainee pairings', async () => {
    jest.spyOn(EventPairing, 'findOne').mockResolvedValue(null);
    const create = jest.spyOn(EventPairing, 'create').mockResolvedValue({
      id: 'pairing-2',
      eventId: 'event-1',
      mentorId: 'mentor-2',
      traineeId: 'trainee-1',
    } as EventPairing);
    const destroy = jest.spyOn(EventPairing, 'destroy');

    await repository.createPairing(
      'event-1',
      'mentor-2',
      'trainee-1',
      'branch-1',
      {} as any,
    );

    expect(destroy).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      {
        eventId: 'event-1',
        mentorId: 'mentor-2',
        traineeId: 'trainee-1',
        branchId: 'branch-1',
      },
      { transaction: expect.anything() },
    );
  });

  it('returns the existing exact pairing without creating a duplicate', async () => {
    const existing = {
      eventId: 'event-1',
      mentorId: 'mentor-1',
      traineeId: 'trainee-1',
    } as EventPairing;
    jest.spyOn(EventPairing, 'findOne').mockResolvedValue(existing);
    const create = jest.spyOn(EventPairing, 'create');

    const result = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      {} as any,
    );

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects reusing a mentor who is paired with another trainee', async () => {
    jest.spyOn(EventPairing, 'findOne').mockResolvedValue({
      eventId: 'event-1',
      mentorId: 'mentor-1',
      traineeId: 'trainee-2',
    } as EventPairing);

    const result = await repository.createPairing(
      'event-1',
      'mentor-1',
      'trainee-1',
      'branch-1',
      {} as any,
    );

    expect(result).toBeNull();
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
