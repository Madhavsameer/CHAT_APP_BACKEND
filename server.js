
require('dotenv').config();


const express = require('express');
const cors = require('cors');

const userRoutes = require('./routes/userRoutes');
const User = require('./models/User');
const Message = require('./models/Message');


const app = express();

app.use(express.urlencoded({extended: true}));
app.use(express.json());

const corsOptions = {
    origin: process.env.FRONTEND_URI,  // 'https://your-deployed-frontend-url'
    methods: 'GET,PUT,POST,DELETE',
    credentials: true,
};

app.use(cors(corsOptions));


app.use('/users', userRoutes);


const server = require('http').createServer(app);

const io = require('socket.io')(server, {
    cors: {
        origin: process.env.FRONTEND_URI,
        methods: ['GET', 'POST']
    }
});


const rooms = ['general', 'tech', 'finance', 'crypto'];


// mongodb connection
const conn = require('./connection');


// function to get last messages from specific room 
async function getLastMessagesFromRoom(room) {

   let roomMessages = await Message.aggregate([
      {$match: {to: room}},
      {$group: {_id: '$date', messagesByDate: {$push: '$$ROOT'}}}
   ]);

   return roomMessages;
}


// function to sort room messages by date 
function sortRoomMessagesByDate(messages) {

    return messages.sort(function(a, b) {
        let date1 = a._id.split('/');
        let date2 = b._id.split('/');
        
        date1 = date1[2] + date1[0] + date1[1];
        date2 = date2[2] + date2[0] + date2[1];

        return date1 < date2 ? -1 : 1;
    });

}


// socket connection
io.on('connection', (socket) => {
    
    socket.on("new-user", async () => {
        const members = await User.find();
        io.emit("new-user", members);
    })


    socket.on('join-room', async (newRoom, previousRoom) => {
        socket.join(newRoom);
        socket.leave(previousRoom);
        let roomMessages = await getLastMessagesFromRoom(newRoom);
        roomMessages = sortRoomMessagesByDate(roomMessages);

        socket.emit('room-messages', roomMessages); 
    })

    
    socket.on('message-room', async (room, content, sender, time, date) =>  {
        // console.log("New Message: ", content);
        const newMessage = await Message.create({content, from: sender, time, date, to: room});

        let roomMessages = await getLastMessagesFromRoom(room);
        roomMessages = sortRoomMessagesByDate(roomMessages);

        // sending message to room
        io.to(room).emit('room-messages', roomMessages);

        socket.broadcast.emit('notifications', room);
    })


    app.delete('/logout', async (req, res) => {
        try {
            const { _id, newMessages } = req.body;

            const user = await User.findById(_id);

            user.status = "offline";
            user.newMessages = newMessages;

            await user.save();

            const members = await User.find();
            socket.broadcast.emit('new-user', members);

            res.status(200).send();
        } catch (e) {
            console.log(e);
            res.status(400).send();
        }
    })
    
});



// GET request: '/rooms' route
app.get('/rooms', (req, res) => {
    res.json(rooms);
});



const PORT = process.env.PORT || 5001;


conn.then(db => {
    if (!db) {
        return process.exit(1);
    }

    // listen to the http server only when we have valid connection to mongodb cluster database
    server.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });

    server.on('error', err => {
        console.log(`Failed To Connect with HTTP Server: ${err}`);
    });

})
// error in mongodb connection
.catch(error => {
    console.log(`Connection Failed...! ${error}`);
});


