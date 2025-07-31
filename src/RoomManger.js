import WebSocket from "ws";
import { createClient } from "redis";
import youtubesearchapi from "youtube-search-api";
import { Job, Queue, Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const TIME_SPAN_FOR_VOTE = 20 * 60 * 1000; // 20min
const TIME_SPAN_FOR_QUEUE = 20 * 60 * 1000; // 20min
const MAX_QUEUE_LENGTH = 20;

const connection = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
};

const redisCredentials = {
    url: `redis://${connection.username}:${connection.password}@${connection.host}:${connection.port}`,
};


export class RoomManager {
    static instance;

    static getInstance() {
        if (!RoomManager.instance) {
            RoomManager.instance = new RoomManager();
        }
        return RoomManager.instance;
    }

    constructor() {
        this.spaces = new Map(); // Map<spaceid, space>
        this.users = new Map(); // Map<userid, { ws: WebSocket[] }>
        this.redisClient = createClient({ url: redisCredentials.url });
        this.subscriber = createClient({ url: redisCredentials.url });
        this.publisher = createClient({ url: redisCredentials.url });
        this.prisma = new PrismaClient();

        const queueName = `room-queue-${process.pid}`;
        this.queue = new Queue(queueName, { connection: redisCredentials });

        this.worker = new Worker(
            queueName,
            async (job) => {
                console.log(`Processing job: ${job.id}`, job.name, job.data);
                // Handle your job logic here
            },
            { connection: redisCredentials }
        );

        this.wsToSpace = new Map(); // Map<WebSocket, spaceid>
    }

    async init() {
        await this.redisClient.connect();
        await this.subscriber.connect();
        await this.publisher.connect();
    }

    async createRoom(spaceid, creatorid) {
        const space = {
            id: spaceid,
            creatorid,
            users: new Set(),
            queue: [],
        };
        this.spaces.set(spaceid, space);
        await this.redisClient.set(`queuelength-${spaceid}`, "0");
    }

    async addUser(userid, ws) {
        this.users.set(userid, {
            id: userid,
            ws: [ws],
        });
    }

    async joinRoom(spaceid, creatorid, userid, ws) {
        let space = this.spaces.get(spaceid);
        let user = this.users.get(userid);

        if (!space) {
            await this.createRoom(spaceid, creatorid);
            space = this.spaces.get(spaceid);
        }

        if (!user) {
            await this.addUser(userid, ws);
            user = this.users.get(userid);
        } else {
            if (!user.ws.includes(ws)) {
                user.ws.push(ws);
            }
        }

        space.users.add(userid);
        this.wsToSpace.set(ws, spaceid);
    }

    async castvote(userid, streamid, vote, spaceid) {
        const space = this.spaces.get(spaceid);
        const user = this.users.get(userid);
        const creatorid = space?.creatorid;
        const iscreator = userid === creatorid;

        if (!iscreator) {
            const lastvoted = await this.redisClient.get(`lastvoted-${userid}`);
            if (lastvoted) {
                user?.ws.forEach((ws) =>
                    ws.send(JSON.stringify({ type: "error", message: "You can only vote after 20 min" }))
                );
                return;
            }

            await this.redisClient.set(`lastvoted-${userid}`, Date.now(), { PX: TIME_SPAN_FOR_VOTE });

            await this.queue.add("cast-vote", {
                creatorid,
                userid,
                streamid,
                vote,
                spaceid,
            });
        }
    }

    async addtoqueue(spaceid, userid, url) {
        const space = this.spaces.get(spaceid);
        const user = this.users.get(userid);
        const creatorid = space?.creatorid;
        const iscreator = userid === creatorid;

        const currentLength = parseInt(await this.redisClient.get(`queuelength-${spaceid}`)) || 0;

        if (currentLength >= MAX_QUEUE_LENGTH) {
            user?.ws.forEach((ws) =>
                ws.send(JSON.stringify({ type: "error", message: "Queue is full" }))
            );
            return;
        }

        if (!iscreator) {
            const lastadded = await this.redisClient.get(`lastadded-${userid}`);
            if (lastadded) {
                user?.ws.forEach((ws) =>
                    ws.send(JSON.stringify({ type: "error", message: "You can only add after 20 min" }))
                );
                return;
            }

            const alreadyadded = await this.redisClient.get(`${spaceid}-${url}`);
            if (alreadyadded) {
                user?.ws.forEach((ws) =>
                    ws.send(JSON.stringify({ type: "error", message: "Already added" }))
                );
                return;
            }

            await this.redisClient.set(`lastadded-${userid}`, Date.now(), { PX: TIME_SPAN_FOR_QUEUE });
            await this.redisClient.set(`${spaceid}-${url}`, "true", { PX: TIME_SPAN_FOR_QUEUE });
        }

        await this.queue.add("add-to-queue", {
            creatorid,
            userid,
            url,
            spaceid,
        });

        await this.redisClient.set(`queuelength-${spaceid}`, (currentLength + 1).toString());
    }

    async admincastvote(creatorid,userid,streamid,vote,spaceid){
        console.log(creatorid, userid, streamid, vote, spaceid);

        if(vote==="upvote"){
            const addvote = await this.prisma.upvote.create({
                data:{
                    userId:userid,
                    streamId:streamid,
                }
            })
            console.log(addvote);
        }
        else{
            const deletevote = await this.prisma.upvote.delete({
                where:{
                    userId:userid,
                    streamId:streamid
                }
            })
            console.log(deletevote)
        }
        await this.publisher.publish(spaceid,{
            type:"new-vote"
        })
    }
}
