const chinaDateTime = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
});

const chinaTime = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Shanghai',
});

function parse(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function formatChinaDateTime(value: string): string {
  const date = parse(value);
  return date ? chinaDateTime.format(date) : '时间不可用';
}

export function formatChinaTime(value: string): string {
  const date = parse(value);
  return date ? chinaTime.format(date) : '时间不可用';
}
