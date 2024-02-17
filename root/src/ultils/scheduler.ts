import nodeScheduler from "node-schedule";

const schedulerArr: Map<
	string,
	{
		id: string;
		description: string;
		time: string;
		authorUsername: string;
		job: nodeScheduler.Job;
		isCancel: boolean;
	}[]
> = new Map();

export const saveJob = (
	groupID: string,
	authorUsername: string,
	description: string,
	time: string,
	job: nodeScheduler.Job
): string => {
	if (!schedulerArr.has(groupID)) {
		schedulerArr[groupID] = [];
	}
	// get unique id for the job
	const id = schedulerArr[groupID].length.toString();
	// save to array
	schedulerArr[groupID].push({
		id,
		description,
		time,
		authorUsername,
		job,
		isCancel: false
	});
	return id;
};

export const getJobs = (groupID: string): string => {
	if (!schedulerArr[groupID] || schedulerArr[groupID].length === 0) {
		return "No job found";
	}
	if (schedulerArr[groupID].every((job) => job.isCancel)) {
		schedulerArr[groupID] = [];
		return "All jobs have been canceled";
	}

	return schedulerArr[groupID]
	.filter((job) => !job.isCancel)
			.map((job) => {
				return `ID: ${job.id}\nDescription: ${job.description}\nTime: ${job.time}\nAuthor: ${job.authorUsername}\n\n`;
		})
		.join("\n");
};

export const cancelJob = (groupID: string, id: number): string => {
	if (!schedulerArr[groupID] || schedulerArr[groupID].length === 0) {
		return "No job found";
	}
	if (id < 0 || id >= schedulerArr[groupID].length) {
		return "Invalid job ID";
	}
	const job = schedulerArr[groupID][id];
	job.job.cancel();
	job.isCancel = true;
	if (schedulerArr[groupID].every((job) => job.isCancel)) {
		schedulerArr[groupID] = [];
	}
	return `Job \`${id}\` has been canceled`;
};
