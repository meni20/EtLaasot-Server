import { Injectable, InternalServerErrorException } from "@nestjs/common";
import VolunteerRepository  from "./volunteer.repository";
import { VolunteerDto } from "./dtos/volunteer.dto";

@Injectable()
export default class VolunteerService {
    constructor(
        private readonly volunteerRepository: VolunteerRepository 
    ){}

    public create (volunteerData: VolunteerDto) {
        try {
            return this.volunteerRepository.create(volunteerData)
        } catch(err) {
            throw new InternalServerErrorException(err)
        }
    }

    public getAllVolunteers() {
        try {
            return this.volunteerRepository.getAllVolunteers()
        } catch(err) {
            throw new InternalServerErrorException(err)
        }
         
    }
}