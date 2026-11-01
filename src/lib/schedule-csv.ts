import type { PublishedScheduleRow } from "@/lib/published-schedule";

// CSV export of a published month, for pasting into a spreadsheet.
export function scheduleToCsv(rows: PublishedScheduleRow[]): string {
  const lines = ["date,start,end,hours,employee"];
  for (const row of rows) {
    const start = new Date(row.starts_at);
    const end = new Date(row.ends_at);
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    lines.push(
      [
        start.toISOString().slice(0, 10),
        start.toTimeString().slice(0, 5),
        end.toTimeString().slice(0, 5),
        hours,
        row.assignee_name,
      ].join(","),
    );
  }
  return lines.join("\n");
}
