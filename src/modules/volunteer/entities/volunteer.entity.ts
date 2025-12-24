import { AllowNull, Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";
import { VolunteerDto } from "../dtos/volunteer.dto";


@Table({
    tableName: 'volunteer',
    paranoid: true
})
export default class Volunteer extends Model<VolunteerDto> {
    @PrimaryKey
    @Column(DataType.STRING)
    declare id: string

    @Column(DataType.STRING)
    name: string

    @Column(DataType.STRING)
    phone: string

    @Column(DataType.STRING)
    traineeId: string

    @AllowNull
    @Column(DataType.STRING)
    adress: string
}