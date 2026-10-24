/** child が parent と同じか、その配下のパスか */
export const isUnder = (child: string, parent: string) =>
  child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
