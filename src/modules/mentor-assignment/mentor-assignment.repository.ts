import { Op, Transaction, type WhereOptions } from 'sequelize';
import { Injectable } from '@nestjs/common';
import MentorAssignment from './entities/mentor-assignment.entity';
import User from '../user/entities/user.entity';
import UserRole from '../user-role/enitites/user-role.entity';
import { AUTH_ROLES } from 'src/constants/auth.constants';

@Injectable()
export default class MentorAssignmentRepository {
  public async create(data: {
    mentorId: string;
    traineeId: string;
    branchId: string;
  }, transaction?: Transaction) {
    return await MentorAssignment.create(data, { transaction });
  }

  public async findActiveByTrainee(
    traineeId: string,
    branchId: string,
    transaction?: Transaction,
  ) {
    return MentorAssignment.findOne({
      where: { traineeId, branchId, isActive: true },
      transaction,
    });
  }

  public async findByBranch(branchId: string) {
    return await MentorAssignment.findAll({
      where: { branchId, isActive: true },
      include: [
        {
          model: User,
          as: 'mentor',
          attributes: ['id', 'name', 'phoneNumber', 'email'],
        },
        {
          model: User,
          as: 'trainee',
          attributes: ['id', 'name', 'phoneNumber', 'email', 'age'],
        },
      ],
    });
  }

  public async findByMentor(mentorId: string) {
    return await MentorAssignment.findAll({
      where: { mentorId, isActive: true },
      include: [
        {
          model: User,
          as: 'trainee',
          attributes: ['id', 'name', 'phoneNumber', 'email', 'age'],
        },
      ],
    });
  }

  public async findById(id: string, transaction?: Transaction) {
    return await MentorAssignment.findByPk(id, { transaction });
  }

  public async deactivate(id: string, transaction?: Transaction) {
    const assignment = await MentorAssignment.findByPk(id, { transaction });
    if (!assignment) return null;
    return await assignment.update(
      { isActive: false, endDate: new Date() },
      { transaction },
    );
  }

  public async getUnassignedTrainees(branchId: string) {
    const assigned = await MentorAssignment.findAll({
      where: { branchId, isActive: true },
      attributes: ['traineeId'],
    });
    const assignedIds = assigned.map((a) => a.traineeId);

    const whereClause: WhereOptions = { branchId };
    if (assignedIds.length > 0) {
      (whereClause as Record<string, unknown>).id = { [Op.notIn]: assignedIds };
    }

    return await User.findAll({
      where: whereClause,
      include: [
        {
          model: UserRole,
          where: { roleId: AUTH_ROLES.TRAINEE.id },
          attributes: [],
        },
      ],
    });
  }
}
