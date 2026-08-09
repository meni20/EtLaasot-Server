import Attendee from './entities/attendee.entity';
import EventPairing from './entities/event-pairing.entity';
import AttendeeRepository from './attendee.repository';
import TraineeMedication from '../trainee-medication/entities/trainee-medication.entity';

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
    expect(attendeeQuery.include[0].include).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: TraineeMedication }),
      ]),
    );
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
