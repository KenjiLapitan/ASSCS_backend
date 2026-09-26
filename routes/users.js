const express = require("express")
const bcrypt = require("bcrypt")
const router = express.Router()
const jwt = require("jsonwebtoken")
const dotenv = require('dotenv')
const {verifyToken} = require('./verify.js')

dotenv.config()

const  { getUsers, registerUser, loginUser, getUserById, editUser, getTotalUsers} = require('../database.js')

router.get('/users', verifyToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1
        const limit = parseInt(req.query.limit) || 10
        const search = req.query.search || ''
        const filter = req.query.filter || 'all'

        if (page < 1 || limit < 1 || limit > 100) {
        return res.status(400).json({ message: "Invalid page or limit" })
        }

        const result = await getUsers({ page, limit, search, filter })

        return res.status(200).json(result)
    } catch (err) {
        return res.status(500).json({ 
            message: "Unexpected Error occurred", 
            error: err.message 
        })
    }
})

router.post("/register", async (req,res) => {
    const {firstname,middlename,lastname,course,role,phone,email,password,status} = req.body
 
    if (!firstname || !lastname|| !role || !phone|| !email || !password) {
        return res.status(422).json({message: "Fill all necessary fields." })
    }       

    if(role === "STUDENT" && !course){
        return res.status(422).json({message: "Student missing course." })
    }

    try {
        const hash = await bcrypt.hash(password,13) 

        await registerUser(firstname,middlename,lastname,course,role,phone,email,hash,status)
        
        return res.status(200).json({message: "REGISTERED SUCCESSFULLY"})
    } catch (error) {
        if(error.code === "23505") return res.status(409).json({message: "EMAIL ALREADY IN USE"})
        
        else return res.status(500).json({message: "ERROR", error})     
    }
})

router.post("/login" , async (req,res) => {
    const {email,password} = req.body    
    
    if (!email || !password) {
        return res.status(400).json({ message: "email and password are required." })
    }

    try {
        const user = await loginUser(email)                 
        if (user[0]) {
            const userbyid = await getUserById(user[0].uid)
            const isValid = await bcrypt.compare(password,user[0].password)
            
            if(user[0].status == 'PENDING') return res.status(203).json({message: "USER STATUS PENDING"})
            if(user[0].status == 'INACTIVE') return res.status(203).json({message: "ACCOUNT DISABLED"})

            if(isValid){
                const fname = userbyid[0].fname
                const lname = userbyid[0].lname
                const name = lname.charAt(0).toUpperCase() + "." + fname.charAt(0).toUpperCase() + fname.slice(1).toLowerCase()
                const token = jwt.sign({ id: user[0].uid, user: user[0].email,name:name,role:user[0].role }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" })

                const isDev = process.env.MODE === 'DEV'
                
                res.cookie("token", token, {
                    httpOnly: true, 
                    secure: true,
                    sameSite: isDev ? "none" : "strict",
                    maxAge: 60 * 60 * 1000, //1 HOUR
                    partitioned: true,
                })
                const currentTime = new Date().toLocaleString()
                console.log(email+" LOGGED IN || TIME: "+currentTime)
                
                return res.status(200).json({message: "LOGGED IN", email:user[0].email,name:name, role:user[0].role})
            }
            else
                return res.status(403).json({message: "WRONG EMAIL OR PASS"})
        } 
        else {
            return res.status(404).json({message: "EMAIL INVALID"})
        }

    } catch (err) {
        console.log(err)
        return res.status(500).json({ message: "Unexpected Error occurred",error:err })
    }
})

router.get('/userbyid',verifyToken, async (req,res) => {
    const {uid} = req.body

    try {        
        const user = await getUserById(uid)
        return res.status(200).json(user)
    } 
    catch (err) {   
        return res.status(500).json({ message: "Unexpected Error occurred",error:err })
    }    
})

router.get('/usercount',verifyToken, async (req,res) => {
    try {        
        const count = await getTotalUsers()
        return res.status(200).json(count)
    } 
    catch (err) {   
        return res.status(500).json({ message: "Unexpected Error occurred",error:err })
    }    
})

router.get("/verify",verifyToken, (req, res) => {
    const token = req.cookies.token  

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
        
    return res.status(200).json({message: "user verified", user: decoded})
})

router.post("/logout", (req, res) => {
    const cookiesToClear = ["token"]

    clearCookies(res, cookiesToClear)
    
    return res.status(200).json({ message: "Logged out" })
})

router.patch("/user/:uid",verifyToken, async(req,res) => {
    const { uid } = req.params
    const { email, phone,password, status } = req.body

    const fields = []
    const values = []

    let index = 1

    if (email !== undefined) {
        fields.push(`email = $${index++}`)
        values.push(email)
    }

    if (phone !== undefined) {
        fields.push(`phone = $${index++}`)
        values.push(phone)
    }

    if (status !== undefined) {
        fields.push(`status = $${index++}`)
        values.push(status)
    }

    if (password !== undefined) {
        fields.push(`password = $${index++}`)
        const hash = await bcrypt.hash(password,13)
        values.push(hash)
    }

    if (fields.length === 0) {
        return res.status(400).json({
            message: "No fields to update"
        })
    }

    values.push(uid)

    const query = `
        UPDATE users
        SET ${fields.join(", ")}
        WHERE uid = $${index}
        RETURNING *
    `

    try {
        await editUser(query, values)
        res.status(200).json({ message: "User info successfully updated" })
    } catch (error) {
        console.error(error)
        res.status(500).json({message: "Failed to update user"})
    }
})

function clearCookies(res, cookieNames) {
    const isDev = process.env.MODE === 'DEV'    
    
    const cookieOptions = {
        httpOnly: true,
        secure: !isDev,
        sameSite: isDev ? "lax" : "none",
        partitioned: !isDev,        
    }

    cookieNames.forEach(name => {
        res.clearCookie(name, cookieOptions)
    })
}

module.exports = router