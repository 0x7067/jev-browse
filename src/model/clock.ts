export function clockContext() {
  return { current_time: new Date().toISOString(), time_zone: "UTC" };
}
