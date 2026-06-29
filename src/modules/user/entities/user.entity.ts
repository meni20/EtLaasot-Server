import {
  Model,
  Table,
  Column,
  HasMany,
  DataType,
  AllowNull,
  PrimaryKey,
  ForeignKey,
  BelongsTo,
  BelongsToMany,
} from 'sequelize-typescript';
import { IUser, ShirtSize, UserGender } from '../interfaces/user.interface';
import Attendee from 'src/modules/attendee/entities/attendee.entity';
import Event from 'src/modules/event/entities/event.entity';
import EventPairing from 'src/modules/attendee/entities/event-pairing.entity';
import UserRole from 'src/modules/user-role/enitites/user-role.entity';
import Branch from 'src/modules/branch/entities/branch.entity';
import VolunteerActivity from 'src/modules/activity/entities/activity.entity';
import { maskNationalIdLast4 } from '../national-id.util';

@Table({
  tableName: 'user',
  paranoid: true,
  timestamps: true,
})
export default class User extends Model<IUser> {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column({ field: 'national_id_hash', type: DataType.STRING(64) })
  declare nationalIdHash: string;

  @AllowNull
  @Column({ field: 'national_id_last4', type: DataType.STRING(4) })
  declare nationalIdLast4: string | null;

  @Column(DataType.STRING)
  declare name: string;

  @Column({ field: 'phone_number', type: DataType.STRING })
  declare phoneNumber: string;

  @AllowNull
  @Column(DataType.STRING)
  declare gender: UserGender | null;

  @AllowNull
  @Column(DataType.STRING)
  declare address: string;

  @AllowNull
  @Column(DataType.STRING)
  declare email: string;

  @AllowNull
  @Column(DataType.INTEGER)
  declare age: number;

  @AllowNull
  @Column({ field: 'date_of_birth', type: DataType.DATEONLY })
  declare dateOfBirth: string | null;

  @AllowNull
  @Column({ field: 'shirt_size', type: DataType.STRING(10) })
  declare shirtSize: ShirtSize | null;

  @AllowNull
  @Column({ field: 'custom_shirt_size', type: DataType.STRING(50) })
  declare customShirtSize: string | null;

  @AllowNull
  @Column(DataType.TEXT)
  declare notes: string | null;

  @AllowNull
  @Column({ field: 'parent_name', type: DataType.STRING(100) })
  declare parentName: string | null;

  @ForeignKey(() => Branch)
  @AllowNull
  @Column(DataType.STRING(50))
  declare branchId: string;

  @BelongsTo(() => Branch)
  declare branch: Branch;

  @HasMany(() => UserRole)
  declare userRoles: UserRole[];

  @HasMany(() => Attendee)
  declare attendees: Attendee[];

  @BelongsToMany(() => Event, () => Attendee)
  declare events: Event[];

  @HasMany(() => EventPairing, 'mentorId')
  declare eventMentorPairings: EventPairing[];

  @HasMany(() => EventPairing, 'traineeId')
  declare eventTraineePairings: EventPairing[];

  @HasMany(() => VolunteerActivity, 'volunteerId')
  declare volunteerActivities: VolunteerActivity[];

  @HasMany(() => VolunteerActivity, 'traineeId')
  declare traineeActivities: VolunteerActivity[];

  toJSON() {
    const values = { ...super.toJSON() } as Record<string, unknown>;
    delete values.nationalIdHash;

    values.nationalIdMasked = maskNationalIdLast4(
      values.nationalIdLast4 as string | null | undefined,
    );

    return values;
  }
}
