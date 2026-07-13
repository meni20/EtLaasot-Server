import {
  Model,
  Table,
  Column,
  HasMany,
  DataType,
  AllowNull,
  PrimaryKey,
  Default,
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
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ field: 'national_id_hash', type: DataType.STRING(64) })
  declare nationalIdHash: string;

  @AllowNull
  @Column({ field: 'national_id_last4', type: DataType.STRING(4) })
  declare nationalIdLast4: string | null;

  @AllowNull
  @Column({ field: 'national_id_encrypted', type: DataType.TEXT })
  declare nationalIdEncrypted: string | null;

  @AllowNull
  @Column({ field: 'password_hash', type: DataType.TEXT })
  declare passwordHash: string | null;

  @AllowNull
  @Column({ field: 'password_changed_at', type: DataType.DATE })
  declare passwordChangedAt: Date | null;

  @Default(false)
  @Column({ field: 'must_change_password', type: DataType.BOOLEAN })
  declare mustChangePassword: boolean;

  @Default(0)
  @Column({ field: 'failed_login_attempts', type: DataType.INTEGER })
  declare failedLoginAttempts: number;

  @AllowNull
  @Column({ field: 'locked_until', type: DataType.DATE })
  declare lockedUntil: Date | null;

  @AllowNull
  @Column({ field: 'temporary_password_expires_at', type: DataType.DATE })
  declare temporaryPasswordExpiresAt: Date | null;

  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @AllowNull
  @Column({ field: 'archived_at', type: DataType.DATE })
  declare archivedAt: Date | null;

  @ForeignKey(() => User)
  @AllowNull
  @Column({ field: 'archived_by', type: DataType.UUID })
  declare archivedBy: string | null;

  @AllowNull
  @Column({ field: 'archive_reason', type: DataType.TEXT })
  declare archiveReason: string | null;

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
    delete values.nationalIdEncrypted;
    delete values.passwordHash;
    delete values.passwordChangedAt;
    delete values.mustChangePassword;
    delete values.failedLoginAttempts;
    delete values.lockedUntil;
    delete values.temporaryPasswordExpiresAt;

    values.nationalIdMasked = maskNationalIdLast4(
      values.nationalIdLast4 as string | null | undefined,
    );

    return values;
  }
}
