import { Injectable } from "@nestjs/common";
import Volunteer from "./entities/volunteer.entity";
import { VolunteerDto } from "./dtos/volunteer.dto";

@Injectable()
export default class VolunteerRepository {

    public async create(volunteerData: VolunteerDto){
        return await Volunteer.create(volunteerData)
    }

    public async getAllVolunteers() {
        return await Volunteer.findAll()
    }
}