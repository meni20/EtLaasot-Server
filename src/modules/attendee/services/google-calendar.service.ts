// import { Injectable } from "@nestjs/common";
// import { google } from "googleapis";
// import * as path from "path";

// @Injectable()
// export class GoogleCalendarService {
//   private calendar = google.calendar("v3");

//   private async getAuthClient() {
//     const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

//     const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

//     const scopes = ["https://www.googleapis.com/auth/calendar"];

//     if (jsonEnv) {
//       const credentials = JSON.parse(jsonEnv);
//       const auth = new google.auth.GoogleAuth({ credentials, scopes });
//       return auth.getClient();
//     }

//     if (!keyPath) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON");

//     const fullPath = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
//     const auth = new google.auth.GoogleAuth({ keyFile: fullPath, scopes });
//     return auth.getClient();
//   }

//   async addEventToCalendar(params: {
//     event: {
//       name: string;
//       startDate: Date;
//       endDate: Date;
//       address: string;
//       description: string;
//     };
//     calendarId: string;
//     timeZone?: string;
//   }) {
//     const authClient = await this.getAuthClient();

//     const timeZone = params.timeZone ?? "Asia/Jerusalem";

//     const res = await this.calendar.events.insert({
//       auth: authClient,
//       calendarId: params.calendarId,
//       requestBody: {
//         summary: params.event.name,
//         location: params.event.address,
//         description: params.event.description,
//         start: {
//           dateTime: params.event.startDate.toISOString(),
//           timeZone,
//         },
//         end: {
//           dateTime: params.event.endDate.toISOString(),
//           timeZone,
//         },
//       },
//     });

//     return {
//       googleEventId: res.data.id,
//       htmlLink: res.data.htmlLink,
//       status: res.data.status,
//     };
//   }
// }
