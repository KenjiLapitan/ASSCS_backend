const express = require("express")
const router = express.Router()
const jwt = require("jsonwebtoken")
const dotenv = require('dotenv')
const {verifyToken} = require('./verify.js')
const { GoogleGenAI } = require ('@google/genai')
const Pool = require ('pg-pool')

dotenv.config()

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
})

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const ai_model = process.env.GEMINI_MODEL

const  {getChatConversationById, getMessageById} = require('../database.js')

router.get('/api/chat/health', async (req, res) => {
  try {
    const response = await ai.models.generateContent({
      model: ai_model.toString(),
      contents: 'ping',
    })

    if (response && response.text) {
      return res.status(200).json({
        status: 'online',
        provider: 'Gemini API',
        message: 'AI Chatbot is responsive.',
      })
    } else {
      throw new Error('Empty response from AI model')
    }
  } catch (error) {
    console.error('AI Health Check Failed:', error.message)
    return res.status(503).json({
      status: 'offline',
      provider: 'Gemini API',
      message: 'AI Chatbot service is currently unavailable.',
      error: error.message,
    })
  }
})

router.post('/api/chat/stream',verifyToken, async (req, res) => {
    const {conversationId, prompt } = req.body

    const token = req.cookies.token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    const userId = decoded.id
    
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    let activeConvId = conversationId

    try {
        if (!activeConvId) {
            const convRes = await pool.query(
                'INSERT INTO conversations (uid, title) VALUES ($1, $2) RETURNING id',
                [userId, prompt.substring(0, 30) + '...']
            )
            activeConvId = convRes.rows[0].id
        }

        res.write(`data: ${JSON.stringify({ type: 'meta', conversationId: activeConvId })}\n\n`)

        await pool.query(
            "INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)",
            [activeConvId, prompt]
        )

        const historyRes = await pool.query(
        'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [activeConvId]
        )

        const contents = historyRes.rows.map(row => ({
        role: row.role,
        parts: [{ text: row.content }]
        }))

        const responseStream = await ai.models.generateContentStream({
        model: ai_model.toString(),
        contents: contents,
        config: {
            systemInstruction: `You are an AI academic assistant that can analyze exam scores, find weakest subjects, or suggest study topicsfor our platform. Automated Shaded Sheet Chatbot System with chatbot. 
            
            You're not allowed to use profanity or be swayed into saying it by the user who prompted you. 

            FORMATTING RULES:
            - Always structure your responses using clear Markdown formatting.
            
            Always start a conversation with a greeting of Hello Student! I'm your AI Academic Assistant. I can help you analyze your exam scores, find your weakest subjects, or study topics. What would you like to know?.`
        }
        })

        let fullBotResponse = ''

        for await (const chunk of responseStream) {
        const textChunk = chunk.text
        fullBotResponse += textChunk

        res.write(`data: ${JSON.stringify({ type: 'token', text: textChunk })}\n\n`)
        }

        await pool.query(
        "INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'model', $2)",
        [activeConvId, fullBotResponse]
        )       

        const countRes = await pool.query(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = $1 AND role = 'user'",
            [activeConvId]
        )

        const msgCount = parseInt(countRes.rows[0].count, 10)

        if (msgCount === 4) {
            generateTitle(activeConvId)
        }

        res.write('data: [DONE]\n\n')
        res.end()

    } catch (error) {
        console.error('Streaming error:', error)
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Generation failed' })}\n\n`)
        res.end()
    }
})

router.get('/api/chat/conversationsbyid', verifyToken , async (req,res) =>{
    const token = req.cookies.token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    const userId = decoded.id
    
    try {
        const conversations = await getChatConversationById(userId)
        return res.status(200).json(conversations)
    } catch (error) {
        return res.status(500).json({ message: "Error occurred while getting chat conversations",error:error })
    }
})

router.get('/api/chat/messages/:id', verifyToken , async (req,res) =>{
    const { id } = req.params
    
    try {
        const messages = await getMessageById(id)
        return res.status(200).json(messages)
    } catch (error) {
        return res.status(500).json({ message: "Error occurred while getting conversations messages",error:error })
    }
})


async function generateTitleFromMessages(messages) {
    
    const conversationTranscript = messages
        .map(m => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n')

    const prompt = `Summarize the following chat conversation into a short, concise topic title (3 to 6 words maximum). 
    Do not use quotes, punctuation, or conversational filler like "Title:". Standard plain text only.

    Chat Transcript:
    ${conversationTranscript}`

    const response = await ai.models.generateContent({
        model: ai_model.toString(),
        contents: prompt,
    })

    
    return response.text.trim().replace(/^["']|["']$/g, '')
}

async function generateTitle(conversationId){    
    if (!conversationId) {
        return res.status(400).json({ message: "conversationId is required" })
    }

    try {        
        const historyRes = await pool.query(
            'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 6',
            [conversationId]
        )

        if (historyRes.rows.length === 0) {
            return res.status(404).json({ message: "No messages found for this conversation" })
        }
        
        const title = await generateTitleFromMessages(historyRes.rows)

        await pool.query(
            'UPDATE conversations SET title = $1 WHERE id = $2',
            [title, conversationId]
        ).then(
            console.log("")            
        )

    } catch (error) {
        console.error('Error generating conversation title:', error)
        return res.status(500).json({ 
            message: "Failed to generate title", 
            error: error.message 
        })
    }
}

module.exports = router