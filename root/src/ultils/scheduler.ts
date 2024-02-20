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

export const getJobs = (groupID: string): {
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
  const job = schedulerArr.get(groupID)[id];
  job.job.cancel();
  job.isCancel = true;
  if (schedulerArr.get(groupID).every((job) => job.isCancel)) {
    schedulerArr.set(groupID, []);
  }
  return `Job \`${id}\` has been canceled`;
};
