import nodeScheduler from "node-schedule";

const schedulerArr: Map<
  string,
  {
    cmdName: string;
    id: string;
    description: string;
    time: string;
    setTime: string;
    authorUsername: string;
    job: nodeScheduler.Job;
    isCancel: boolean;
  }[]
> = new Map();

export const saveJob = (
  cmdName: string,
  groupID: string,
  authorUsername: string,
  description: string,
  time: string,
  setTime: string,
  job: nodeScheduler.Job
): string => {
  if (!schedulerArr.has(groupID)) {
    schedulerArr.set(groupID, []);
  }
  // get unique id for the job
  const id = schedulerArr.get(groupID).length.toString();
  // save to array
  schedulerArr.get(groupID).push({
    cmdName,
    id,
    description,
    time,
    setTime,
    authorUsername,
    job,
    isCancel: false,
  });
  return id;
};

export const getJobs = (
  groupID: string
): {
  cmdName: string;
  id: string;
  description: string;
  time: string;
  setTime: string;
  authorUsername: string;
  job: nodeScheduler.Job;
  isCancel: boolean;
}[] => {
  if (!schedulerArr.get(groupID) || schedulerArr.get(groupID).length === 0) {
    return [];
  }

  return schedulerArr.get(groupID);
};

export const cancelJob = (groupID: string, id: number): string => {
  if (!schedulerArr.get(groupID) || schedulerArr.get(groupID).length === 0) {
    return "No job found";
  }
  if (id < 0 || id >= schedulerArr.get(groupID).length) {
    return "Invalid job ID";
  }
  // Ids are array indexes and are shown to users, so entries are never
  // removed: reusing an id would cancel a different job than the one listed.
  const job = schedulerArr.get(groupID)[id];
  if (job.isCancel) return `Job \`${id}\` was already canceled`;
  job.job?.cancel();
  job.isCancel = true;
  return `Job \`${id}\` has been canceled`;
};
