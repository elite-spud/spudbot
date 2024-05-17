import { JWT } from "google-auth-library";
import { Future } from "./Future";
import { google, sheets_v4 } from "googleapis";

export interface GoogleAPIConfig {
    oauth: {
        clientId: string;
        clientSecret: string;
        scope: string;
    };
    jwt: {
        type: string,
        project_id: string,
        private_key_id: string,
        private_key: string,
        client_email: string,
        client_id: string,
        auth_uri: string,
        token_uri: string,
        auth_provider_x509_cert_url: string,
        client_x509_cert_url: string,
        universe_domain: string,
    };
}

export class GoogleAPI {
    public static readonly incentiveSheetId = "1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY";

    protected readonly _config: GoogleAPIConfig
    protected readonly _googleSheets = new Future<sheets_v4.Sheets>();

    public constructor(config: GoogleAPIConfig) {
        this._config = config;
    }

    public async startup(): Promise<void> {
        const client = new JWT({
            email: this._config.jwt.client_email,
            key: this._config.jwt.private_key,
            scopes: ["https://www.googleapis.com/auth/drive"],
        });

        const sheets = google.sheets({
            version: 'v4',
            auth: await client,
        });

        this._googleSheets.resolve(sheets);
    }

    public async testGoogleApi(): Promise<void> {
        const sheets = await this._googleSheets;

        const resource = await sheets.spreadsheets.values.get({
            spreadsheetId: "1dNi-OkDok6SH8VrN1s23l-9BIuekwBgfdXsu-SqIIMY",
            range: "A1:B2",
        });
        const rows = resource.data.values;
        if (!rows) {
            console.log("no rows found");
            return;
        }
        for (const row of rows) {
            for (const cell of row) {
                console.log(cell);
            }
        }

        const batchUpdateRequest: sheets_v4.Schema$BatchUpdateValuesRequest = {
            valueInputOption: "RAW",
            data: [
                {
                    range: "Sheet3!A1",
                    values: [
                        ["A1"],
                    ]
                },
                {
                    range: "Sheet3!A4:C4",
                    values: [
                        ["foo", "bar"],
                    ]
                },
                {
                    range: "Sheet3!A6:A10",
                    values: [
                        ["foo"], ["bar"],
                    ]
                },
            ]
        };
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: GoogleAPI.incentiveSheetId,
            requestBody: batchUpdateRequest,
        });

        await this.getSpreadsheetInfo(GoogleAPI.incentiveSheetId, ["General Incentives!A1:Z50"]);
    }

    public async getSpreadsheetInfo(spreadsheetId: string, ranges: string[]): Promise<void> {
        const googleSheets = await this._googleSheets;

        const spreadsheet = await googleSheets.spreadsheets.get({
            includeGridData: true,
            ranges: ranges,
            spreadsheetId: spreadsheetId,
        });

        console.log(spreadsheet.data);
        if (!spreadsheet.data.sheets) {
            return;
        }
        for (const sheet of spreadsheet.data.sheets) {
            if (!sheet.data) {
                continue;
            }
            for (const window of sheet.data) {
                if (!window.rowData) {
                    continue;
                }
                for (const row of window.rowData) {
                    if (!row.values) {
                        continue;
                    }
                    let rowStr = "";
                    for (const value of row.values) {
                        rowStr += value.formattedValue + ",";
                    }
                    console.log(rowStr);
                }
            }
        }
    }

    protected subIncentiveToChatMessage(currentSubPoints: number, requiredSubPoints: number, activity: string): void {
        `We are currently at ${currentSubPoints}/${requiredSubPoints} towards the current subgoal incentive. If that goal is met, I'll ${activity}`;
    }
}