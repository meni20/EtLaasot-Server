import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import BranchRepository from './branch.repository';
import { IBranch } from './interfaces/branch.interface';
import UserService from '../user/user.service';
import EventService from '../event/event.service';
import AttendeeService from '../attendee/attendee.service';
import MentorAssignmentService from '../mentor-assignment/mentor-assignment.service';
import { AUTH_ROLES } from 'src/constants/auth.constants';

@Injectable()
export default class BranchService {
  constructor(
    private readonly branchRepository: BranchRepository,
    private readonly userService: UserService,
    private readonly eventService: EventService,
    private readonly attendeeService: AttendeeService,
    private readonly mentorAssignmentService: MentorAssignmentService,
  ) {}

  public async createBranch(data: IBranch) {
    try {
      return await this.branchRepository.create(data);
    } catch {
      throw new InternalServerErrorException('Failed to create branch');
    }
  }

  public async getAllBranches() {
    try {
      return await this.branchRepository.findAll();
    } catch {
      throw new InternalServerErrorException('Failed to fetch branches');
    }
  }

  public async getBranchById(id: string) {
    const branch = await this.branchRepository.findById(id);
    if (!branch) {
      throw new NotFoundException(`Branch ${id} not found`);
    }
    return branch;
  }

  public async updateBranch(id: string, data: Partial<IBranch>) {
    const branch = await this.branchRepository.update(id, data);
    if (!branch) {
      throw new NotFoundException(`Branch ${id} not found`);
    }
    return branch;
  }

  public async getBranchDashboard(branchId: string) {
    try {
      const [
        totalVolunteers,
        totalTrainees,
        upcomingEvents,
        recentAttendance,
        monthlyStats,
        mentorAssignments,
        unassignedTrainees,
      ] = await Promise.all([
        this.userService.countByBranchAndRole(
          branchId,
          AUTH_ROLES.VOLUNTEER.id,
        ),
        this.userService.countByBranchAndRole(branchId, AUTH_ROLES.TRAINEE.id),
        this.eventService.getUpcomingByBranch(branchId, 100),
        this.attendeeService.getRecentAttendanceByBranch(branchId, 30),
        this.attendeeService.getMonthlyStatsByBranch(branchId, 6),
        this.mentorAssignmentService.getAssignmentsByBranch(branchId),
        this.mentorAssignmentService.getUnassignedTrainees(branchId),
      ]);

      return {
        summary: {
          totalVolunteers,
          totalTrainees,
          activeEvents: upcomingEvents.length,
          attendanceRate: recentAttendance.rate,
          unassignedTrainees: unassignedTrainees.length,
        },
        upcomingEvents,
        monthlyStats,
        mentorAssignments,
        recentAttendance,
      };
    } catch {
      throw new InternalServerErrorException('Failed to fetch dashboard data');
    }
  }
}
