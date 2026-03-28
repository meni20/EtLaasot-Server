import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import MentorAssignmentRepository from './mentor-assignment.repository';

@Injectable()
export default class MentorAssignmentService {
  constructor(
    private readonly mentorAssignmentRepository: MentorAssignmentRepository,
  ) {}

  public async assignTrainee(
    mentorId: string,
    traineeId: string,
    branchId: string,
  ) {
    try {
      return await this.mentorAssignmentRepository.create({
        mentorId,
        traineeId,
        branchId,
      });
    } catch {
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
    const old = await this.mentorAssignmentRepository.findById(assignmentId);
    if (!old) {
      throw new NotFoundException(`Assignment ${assignmentId} not found`);
    }

    await this.mentorAssignmentRepository.deactivate(assignmentId);

    return await this.mentorAssignmentRepository.create({
      mentorId: newMentorId,
      traineeId: old.traineeId,
      branchId: old.branchId,
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
