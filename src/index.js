import http from "http"
import dotenv from "dotenv"
import { WebSocket, WebSocketServer } from "ws";

dotenv.config();

async function createserver() {
    return http.createServer((req, res) => {
        // Set the response HTTP header with HTTP status and Content type
        res.writeHead(200, { 'Content-Type': 'text/plain' });

        // Send the response body as 'Hello, World!'
        res.end('Hello, World!\n');
    });
}

async function handleconnection(ws){
    ws.on("message",async (raw)=>{
        const {type,data} = JSON.parse(raw);
        console.log(type,data);
        switch (type){
            case "join-room":
                await handlejoinroom(ws,data)
                break
            default:
                await handleuseraction(ws,type,data)
        }
    })
}


async function handleuseraction(ws,type,data){
    console.log("handleuseraction", type, data);
    switch(type){
        case "cast-vote":
            await 
    }
}
async function main() {
    const server = await createserver();
    const wss  = new WebSocketServer({server})
     wss.on("connection",handleconnection(ws))

    server.listen(3000, () => {
        console.log("Server is running on port 3000");
    });
}

main();
