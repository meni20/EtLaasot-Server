import { Controller } from "@nestjs/common";
import UserRoleService from "./user-role.service";


@Controller("user-role")
export default class UserRoleController {
    constructor(private readonly userRoleService: UserRoleService) {}

    
}