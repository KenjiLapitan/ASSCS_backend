const jwt = require("jsonwebtoken")
const dotenv = require('dotenv')

dotenv.config()

function verifyToken(req,res,next){
    const token = req.cookies.token;

    if (!token){   
        return res.status(403).json({ message: "Unauthorized" })          
    } 

    try {
        jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
        return next()              
    } 
    catch (err) {
        return res.status(401).json({ message: "Invalid token" });        
    }
}

module.exports = {verifyToken};