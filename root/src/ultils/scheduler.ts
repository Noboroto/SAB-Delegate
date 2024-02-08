import nodeScheduler from 'node-schedule'

const schedulerArr: Map<string, {
	id: string,
	description: string,
	time: string,
	job: nodeScheduler.Job
}[]> = new Map();

export const saveJob = (groupID: string, description: string, time: string, job: nodeScheduler.Job):string => {
	if (!schedulerArr[groupID]) {
		schedulerArr[groupID] = [];
	}
	schedulerArr[groupID].push(job);
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

export const getJobs = (groupID: string):string => {
	if (!schedulerArr[groupID]) {
		return "No job found";
	}
	return schedulerArr[groupID].map((job, index) => {
		return `${index}. ${job.description} - ${job.time}`;
	}).join("\n");
}

export const cancelJob = (groupID: string, id: number) => {
	if (!schedulerArr[groupID]) {
		return;
	}
	const job = schedulerArr[groupID][id];
	job.cancel();
	schedulerArr[groupID].splice(id, 1);
}