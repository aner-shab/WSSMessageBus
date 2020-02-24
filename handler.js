const uuid = require("uuid/v4");
const writer = require("../api/utils/writer");
const logger = require('../utils/logger/logger')(module);
const dateUtils = require("../utils/dateUtils");
const config = require('../config');

// Subscription msg from client:
// {
//     EventsType: this.EventsType.CatalogEvents,
//     Subscribe: true
// }

EventsType = {
    ScenarioEvents: "ScenarioEvents",
    CatalogEvents: "CatalogEvents",
    SimulationEvents: "SimulationEvents"
};
Events = {
    ScenarioEvents: {
        ScenarioAdded: "ScenarioAdded",
        ScenarioDeleted: "ScenarioDeleted"
    },
    CatalogEvents: {
        SensorPresetAdded: "SensorPresetAdded",
        SensorPresetRemoved: "SensorPresetRemoved",
        SensorPresetUpdated: "SensorPresetUpdated"
    },
    SimulationEvents: {
        SimRunStatusChanged: "SimRunStatusChanged",
        SimRunCreated: "SimRunCreated"
    }
}

tickets = {}; // Store of tickets issued by API call
clients = {}; // Map of connected websocket clients

// Connection event
module.exports.init = (socket) =>{
    const id = uuid();
    logger.info(`Websocket: Incoming connection: ${id} `);
    if (!validateTicket(socket, id)){
        return;
    }
    socket.on('disconnect', function() {
        logger.info(`Websocket: Closing connection for client: ${socket.uuid}`);
        delete clients[socket.uuid];
    });

    socket.on('message', function incoming(message) {
        onMessage(message, socket);
    });
}

// Ticket comprised of timestamp + uuid
module.exports.issueTicket = (req,res) =>{
    const ticket = new Date().getTime() + "-" + uuid();
    tickets[ticket] = {
        expiration: extendTicketExpiration()
    };
    res.statusCode = 200;
    writer.writeJson(res, {
        ticket: ticket
    });
}

module.exports.updateClientSockets = (event, payload) => {
    for (let client of Object.values(clients)){
        if (client.subscriptions.includes(eventType)){
            client.send({
                Event: event,
                Data: payload
            });
        }
    }
}

const onInvalidConnection = (socket, ticket) =>{
    logger.error(`Websocket: Invalid ticket from incoming connection: ${ticket}, terminating socket connection.`);
    if (tickets[ticket]){
        delete tickets[ticket];
    }
    socket.disconnect(true);
    return false;
}

// Message received from client
const onMessage = (message, socket) => {
    if (!message){
        return;
    }

    // Validate JSON, subscription, and expiration
    if (!validateJSONFormat(socket, message)
    && !validateSubscription(socket)
    && !validateExpiration(socket)){
        return;
    }

    logger.info(`Websocket: Incoming msg: %o`, message);

    // Subscribe.
    const clientId = socket.uuid;
    if (clients[clientId]){
        if (EventsType[message.EventsType]){
            const isSubscribedIndex = clients[clientId].subscriptions.findIndex(sub => sub === message.EventsType);
            if (isSubscribedIndex > -1){
                if (message.Subscribe !== true){
                    clients[clientId].subscriptions.splice(isSubscribedIndex, 1);
                    logger.info(`Websocket: Unsubscribing ${clientId} from ${message.EventsType}`);
                    socket.send(`Unsubscribed from ${message.EventsType}`);
                }else{
                    socket.send(`Already subscribed to ${message.EventsType}`);
                }
            }else {
                if (message.Subscribe){
                    clients[clientId].subscriptions.push(message.EventsType);
                    logger.info(`Websocket: Subscribing ${clientId} to ${message.EventsType}`);
                    socket.send(`Subscribed to ${message.EventsType}`);
                } else{
                    socket.send(`No change: you are not subscribed to ${message.EventsType}`);
                }
            }
        }else{
            socket.send(`No EventsType of type: ${message.EventsType}`);
        }
    }
}

const validateTicket = (socket, id) => {
    const ticket = socket.handshake.query.ticketId;
    if (tickets[ticket]){
        socket.uuid = id;
        clients[socket.uuid] = socket;
        clients[socket.uuid].ticket = ticket;
        clients[socket.uuid].subscriptions = [];
        logger.info(`Websocket: Client ${socket.uuid} connected.`);
        socket.send("Established websocket connection with server.");
        return true;
    }else{
        return onInvalidConnection(socket, id, ticket);
    }
}

const validateJSONFormat = (socket, message) => {
    if (message.hasOwnProperty('Subscribe') && message.hasOwnProperty('EventsType')){
        return true;
    } else{
        logger.error(`Websocket message from ${socket.uuid} is in invalid format: ${message}`);
        socket.send('Websocket message must be sent in a valid JSON format.');
        return false;
    }
}

const validateSubscription = (socket) => {
    const client = clients[socket.uuid];
    if (!client || !client.ticket){
        return onInvalidConnection(socket, socket.uuid, undefined);
    }
    return true;
}

const validateExpiration = (socket) => {
    const now = new Date();
    const isExpired = now > tickets[client.ticket].expiration;
    if (!isExpired){
        tickets[client.ticket].expiration = extendTicketExpiration();
        return true;
    }else{
        logger.error(`Expired Websocket ticket for ${socket.uuid}; connection rejected.`)
        return onInvalidConnection(socket, client.ticket);
    }
}

const extendTicketExpiration = () => {
    return dateUtils.minutesFromNow(config.tokenExpirationInMinutes)
}



module.exports.EventsType = EventsType;
module.exports.Events = Events;
