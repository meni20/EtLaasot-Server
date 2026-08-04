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
});
