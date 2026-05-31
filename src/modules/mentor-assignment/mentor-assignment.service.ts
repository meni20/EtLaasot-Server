import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import MentorAssignmentRepository from './mentor-assignment.repository';
import { Sequelize } from 'sequelize-typescript';

@Injectable()
export default class MentorAssignmentService {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly mentorAssignmentRepository: MentorAssignmentRepository,
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

        return await this.mentorAssignmentRepository.create(
          {
            mentorId,
            traineeId,
            branchId,
          },
          transaction,
        );
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new InternalServerErrorException('Failed to create assignment');
    }
  }

  public async getAssignmentsByBranch(branchId: string) {
    try {
      return await this.mentorAssignmentRepository.findByBranch(branchId);
    } catch {
      throw new InternalServerErrorException('Failed to fetch assignments');
    }
  }

  public async getMyTrainees(mentorId: string) {
    try {
      return await this.mentorAssignmentRepository.findByMentor(mentorId);
    } catch {
      throw new InternalServerErrorException('Failed to fetch trainees');
    }
  }

  public async removeAssignment(id: string) {
    const result = await this.mentorAssignmentRepository.deactivate(id);
    if (!result) {
      throw new NotFoundException(`Assignment ${id} not found`);
    }
    return result;
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

      return await this.mentorAssignmentRepository.create(
        {
          mentorId: newMentorId,
          traineeId: old.traineeId,
          branchId: old.branchId,
        },
        transaction,
      );
    });
  }

  public async getUnassignedTrainees(branchId: string) {
    try {
      return await this.mentorAssignmentRepository.getUnassignedTrainees(
        branchId,
      );
    } catch {
      throw new InternalServerErrorException(
        'Failed to fetch unassigned trainees',
      );
    }
  }
}
