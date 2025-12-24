import { Module } from '@nestjs/common';
import  VolunteerController  from './volunteer.controller';
import  VolunteerService from './volunteer.service';
import  VolunteerRepository  from './volunteer.repository';

@Module({
  controllers: [VolunteerController],
  providers: [VolunteerService, VolunteerRepository],
  exports: [VolunteerService],
})
export class VolunteerModule {}
