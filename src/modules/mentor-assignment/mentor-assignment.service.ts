import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import MentorAssignmentRepository from './mentor-assignment.repository';
import { Sequelize } from 'sequelize-typescript';
import UserService from '../user/user.service';

@Injectable()
export default class MentorAssignmentService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly mentorAssignmentRepository: MentorAssignmentRepository,
    private readonly userService: UserService,
  ) {}

  public async assignTrainee(
    mentorId: string,
    traineeId: string,
    branchId: string,
  ) {
    try {
      return await this.sequelize.transaction(async (transaction) => {
        const existing =
          await this.mentorAssignmentRepository.findActiveByTrainee(
            traineeId,
            branchId,
            transaction,
          );

        if (existing) {
          throw new ConflictException('Trainee already has an active mentor');
        }

        const assignment = await this.mentorAssignmentRepository.create(
          {
            mentorId,
            traineeId,
            branchId,
          },
          transaction,
        );
        return this.toSafeAssignment(assignment);
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException('Failed to create assignment');
    }
  }

  public async getAssignmentsByBranch(branchId: string) {
    try {
      const assignments =
        await this.mentorAssignmentRepository.findByBranch(branchId);
      return assignments.map((assignment) => this.toSafeAssignment(assignment));
    } catch {
      throw new InternalServerErrorException('Failed to fetch assignments');
    }
  }

  public async getMyTrainees(mentorId: string) {
    try {
      const assignments =
        await this.mentorAssignmentRepository.findByMentor(mentorId);
      return assignments.map((assignment) => this.toSafeAssignment(assignment));
    } catch {
      throw new InternalServerErrorException('Failed to fetch trainees');
    }
  }

  public async removeAssignment(id: string) {
    const result = await this.mentorAssignmentRepository.deactivate(id);
    if (!result) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    return this.toSafeAssignment(result);
  }

  public async transferTrainee(assignmentId: string, newMentorId: string) {
    return await this.sequelize.transaction(async (transaction) => {
      const old = await this.mentorAssignmentRepository.findById(
        assignmentId,
        transaction,
      );
      if (!old) {
        throw new NotFoundException(`Assignment ${assignmentId} not found`);
      }

      await this.mentorAssignmentRepository.deactivate(
        assignmentId,
        transaction,
      );

      const assignment = await this.mentorAssignmentRepository.create(
        {
          mentorId: newMentorId,
          traineeId: old.traineeId,
          branchId: old.branchId,
        },
        transaction,
      );
      return this.toSafeAssignment(assignment);
    });
  }

  public async getUnassignedTrainees(branchId: string) {
    try {
      const trainees =
        await this.mentorAssignmentRepository.getUnassignedTrainees(branchId);
      return trainees.map((trainee) =>
        typeof trainee.toJSON === 'function' ? trainee.toJSON() : trainee,
      );
    } catch {
      throw new InternalServerErrorException(
        'Failed to fetch unassigned trainees',
      );
    }
  }

  public resolveLegacyUserId(publicUserId: string) {
    return this.userService.resolveLegacyUserId(publicUserId);
  }

  private toSafeAssignment(assignment: any) {
    return typeof assignment?.toJSON === 'function'
      ? assignment.toJSON()
      : assignment;
  }
}
