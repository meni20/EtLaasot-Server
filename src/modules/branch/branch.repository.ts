import { Injectable } from '@nestjs/common';
import Branch from './entities/branch.entity';
import { IBranch } from './interfaces/branch.interface';
import { BRANCH_DISPLAY_BY_ID, applyBranchDisplay } from 'src/constants/auth.constants';

@Injectable()
export default class BranchRepository {
  public async create(data: IBranch) {
    const display = BRANCH_DISPLAY_BY_ID[data.id];
    const payload = display
      ? {
          ...data,
          name: display.name,
          city: display.city,
        }
      : data;

    const branch = await Branch.create(payload as any);
    return applyBranchDisplay(branch);
  }

  public async findAll() {
    const branches = await Branch.findAll({ where: { isActive: true } });
    return branches.map((branch) => applyBranchDisplay(branch));
  }

  public async findById(id: string) {
    const branch = await Branch.findByPk(id);
    return applyBranchDisplay(branch);
  }

  public async update(id: string, data: Partial<IBranch>) {
    const branch = await Branch.findByPk(id);
    if (!branch) return null;

    const display = BRANCH_DISPLAY_BY_ID[id];
    const payload = display
      ? {
          ...data,
          name: display.name,
          city: display.city,
        }
      : data;

    await branch.update(payload);
    return applyBranchDisplay(branch);
  }
}
