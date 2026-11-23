export function downloadReportCsv(report) {
  if (!report || !Array.isArray(report.rows)) return;
  const escape = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = [
    'Employee Name',
    'Designation',
    'On Time',
    'Late',
    'Leave',
    'Absent',
    'Other Office Days',
    'Total Settled'
  ];
  const lines = [headers.join(',')];

  for (const row of report.rows) {
    const total = (row.onTime || 0) + (row.late || 0) + (row.leave || 0) + (row.absent || 0);
    lines.push(
      [
        escape(row.name),
        escape(row.designation),
        row.onTime || 0,
        row.late || 0,
        row.leave || 0,
        row.absent || 0,
        row.otherOfficeDays || 0,
        total
      ].join(',')
    );
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `EMS_Report_${report.officeName.replace(/\s+/g, '_')}_${report.month}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
