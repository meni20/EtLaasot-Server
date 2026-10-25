import type { VolunteerData } from './volunteer.contract';
import type { ShirtSize } from '../user/interfaces/user.interface';
// Prepared for future approval only. Never substitute a parent's phone.
export function volunteerApprovedProfileMapping(data: VolunteerData) {
  const v = data.volunteer!;
  return {
    name: `${v.firstName} ${v.lastName}`.trim(),
    phoneNumber: v.phone,
    address: v.address,
    dateOfBirth: v.dateOfBirth,
    gender: v.gender,
    email: v.email,
    shirtSize: v.shirtSize as ShirtSize | undefined,
    customShirtSize: v.shirtSize === 'OTHER' ? v.customShirtSize : null,
  };
}
