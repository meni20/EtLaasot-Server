import { Body, Controller, Get, Post } from '@nestjs/common';
import AttendeeService from './attendee.service';

@Controller('attendee')
export default class AttendeeController {
  constructor(private readonly attendeeService: AttendeeService) {}
}
