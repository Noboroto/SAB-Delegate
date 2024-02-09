import nodeScheduler from 'node-schedule'

const schedulerArr: Map<string, {
	id: string,
	description: string,
	time: string,
	job: nodeScheduler.Job
}[]> = new Map();

export const saveJob = (groupID: string, description: string, time: string, job: nodeScheduler.Job): string => {
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
		job
	});
	return id;
}

export const getJobs = (groupID: string): string => {
	if (!schedulerArr[groupID] || schedulerArr[groupID].length === 0) {
		return "No job found";
	}
	return schedulerArr[groupID].map((job) => {
		return `\`${job.id}\`. ${job.description} - ${job.time}`;
	}).join("\n");
}

export const cancelJob = (groupID: string, id: number): string => {
	if (!schedulerArr[groupID] || schedulerArr[groupID].length === 0) {
		return "No job found";
	}
	const job = schedulerArr[groupID].find((job) => job.id === id.toString());
	if (!job) {
		return "Job not found";
	}
	const index = schedulerArr[groupID].indexOf(job);
	job.cancel();
	schedulerArr[groupID].splice(index, 1);
	return `Job \`${id}\` has been canceled`;
}