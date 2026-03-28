import { Injectable } from '@nestjs/common';
import Branch from './entities/branch.entity';
import { IBranch } from './interfaces/branch.interface';

@Injectable()
export default class BranchRepository {
  public async create(data: IBranch) {
    return await Branch.create(data as any);
  }

  public async findAll() {
    return await Branch.findAll({ where: { isActive: true } });
  }

  public async findById(id: string) {
    return await Branch.findByPk(id);
  }

  public async update(id: string, data: Partial<IBranch>) {
    const branch = await Branch.findByPk(id);
    if (!branch) return null;
    return await branch.update(data);
  }
}
