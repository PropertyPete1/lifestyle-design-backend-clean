import { google } from 'googleapis';

type LogRow = {
  Address: string;
  Owner?: string;
  Price?: string;
  Bedrooms?: number | string;
  Type: 'rent' | 'sale';
  Status: string;
  Timestamp: string;
  Reason?: string;
};

export async function appendLogsToSheet(googleSheetUrl: string, rows: LogRow[]) {
  if (!googleSheetUrl || rows.length === 0) return { appended: 0 };
  const sheetId = extractSheetId(googleSheetUrl);
  if (!sheetId) return { appended: 0 };

  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const values = rows.map(r => [r.Address, r.Owner || '', r.Price || '', r.Bedrooms ?? '', r.Type, r.Status, r.Timestamp, r.Reason || '']);
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:H',
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  return { appended: rows.length };
}

function extractSheetId(url: string): string | null {
  const m = url.match(/docs.google.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}


