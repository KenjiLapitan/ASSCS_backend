const express = require("express")
const cors = require("cors")
const cookieParser = require("cookie-parser")
const dotenv = require('dotenv')
const pool = require('./database'); 

const allowedOrigins = process.env.ALLOW_ORIGINS? process.env.ALLOW_ORIGINS.split(',').map(origin => origin.trim()): []
const mode = process.env.MODE;

const app = express()
app.use(express.json())
app.use(cookieParser());

app.use(
  cors({
    origin: function (origin, callback) {      
      if (mode === 'DEV' && (!origin || origin.match(/^http?:\/\/.*:5173$/) || origin.match(/^http?:\/\/.*:4173$/))) {
        callback(null, true);
      } 
      else if(allowedOrigins.includes(origin)){
        callback(null, true);
      }
      else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.get("/", (req, res)=>{      
    res.json(
        {
            message: "Automated Shaded Sheet Checker System API"
        }
    );
});

const PORT = 8080
app.listen(PORT, ()=>{
    console.log(`SERVER IS RUNNING ON http://localhost:${PORT}`)
});

const userRouter = require("./routes/users.js")

app.use(userRouter)