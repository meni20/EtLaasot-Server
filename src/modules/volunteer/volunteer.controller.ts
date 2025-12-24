import { Controller, Get, Post } from "@nestjs/common";
import VolunteerService from "./volunteer.service";
import { VolunteerDto } from "./dtos/volunteer.dto";


@Controller('volunteer')
export default class VolunteerController {
    constructor(private readonly volunteerService: VolunteerService) {}

    @Post('create')
    public create(volunteerData: VolunteerDto){
        return this.volunteerService.create(volunteerData)
    }

    @Get('get-all-volunteers')
    public getAllVolunteers(){
        return this.volunteerService.getAllVolunteers()
    }
}