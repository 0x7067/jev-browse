const DATE_TOKEN = /\{\{DATE\+(\d+)d\}\}/g;

export function expandDates(text, now) {
  return text.replace(DATE_TOKEN, (_, days) => {
    const date = new Date(now);
    date.setDate(date.getDate() + Number(days));

    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  });
}
