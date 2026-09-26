const express = require("express")
const bcrypt = require("bcrypt")
const router = express.Router()
const jwt = require("jsonwebtoken")
const dotenv = require('dotenv')
const {verifyToken} = require('./verify.js')


const  { createExam, getExams, deleteExam, uploadAnswerKey, gradeAndSaveResult, getStudentResults, getStudentExamStats, getStudentSubjectStrengths, getStudentGradeTrend, getStudentTakenExamResults, getExamsWithAnswerKeysCount, getOverallAverageScore} = require('../database.js')

router.get('/exams', verifyToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1
        const limit = parseInt(req.query.limit) || 10
        const search = req.query.search || ''

        if (page < 1 || limit < 1 || limit > 100) {
        return res.status(400).json({ message: "Invalid page or limit" })
        }

        const result = await getExams({ page, limit, search })

        return res.status(200).json(result)
    } catch (err) {
        return res.status(500).json({ 
            message: "Unexpected Error occurred", 
            error: err.message 
        })
    }
})

router.post("/exam",verifyToken, async (req, res) => {
const token = req.cookies.token
const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)

    try {
        let { subject, title, type, numberOfItems} = req.body
        
        if (subject != null) {
          subject = subject.toUpperCase();
        }

        if (title != null) {
          title = title.toUpperCase();
        }

        const userId = decoded.id    

        if (!subject) {
        return res.status(400).json({ error: "Subject is required" })
        }

        const result = await createExam(subject, title, type, userId, numberOfItems)

        res.status(200).json({
        message: "Exam created successfully",
        exam: result.rows[0],
        });
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: "Failed to create exam" })
    }
})

router.delete('/exam/:id', verifyToken, async (req, res) => {
  try {
    const examId = parseInt(req.params.id)

    if (!examId || isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' })
    }

    const result = await deleteExam(examId)

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Exam not found' })
    }

    return res.status(200).json({
      message: 'Exam deleted successfully',
      exam: result.rows[0]
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({
      message: 'Failed to delete exam',
      error: err.message
    })
  }
})

router.post('/exam/:id/answer-key', verifyToken, async (req, res) => {
  try {
    const examId = parseInt(req.params.id)
    const { answers } = req.body

    if (!examId || isNaN(examId)) {
      return res.status(400).json({ message: 'Invalid exam ID' })
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: 'Answers must be a non-empty array' })
    }

    const result = await uploadAnswerKey(examId, answers)

    return res.status(200).json({
      message: 'Answer key saved successfully',
      answerKey: result
    })
  } catch (err) {
    console.error(err)
    return res.status(500).json({
      message: 'Failed to save answer key',
      error: err.message
    })
  }
})

router.post('/exam/check', verifyToken, async (req, res) => {
  try {
    let { examCode, studentId, studentAnswers } = req.body

    examCode = examCode.toUpperCase()

    if (!examCode || !studentId || !Array.isArray(studentAnswers) || studentAnswers.length === 0) {
      return res.status(400).json({ 
        message: 'examCode, studentId and studentAnswers are required' 
      })
    }

    const result = await gradeAndSaveResult(examCode, studentId, studentAnswers)

    return res.status(200).json({
      message: 'Exam graded and saved successfully',
      result
    })
  } catch (err) {
    console.error(err)
    return res.status(400).json({
      message: err.message || 'Failed to grade exam'
    })
  }
})

router.get('/student/:studentId/results', verifyToken, async (req, res) => {
    try {
        const studentId = req.params.studentId

        if (!studentId) {
            return res.status(400).json({
                message: 'Student ID is required'
            })
        }

        const results = await getStudentResults(studentId)

        return res.status(200).json({
            data: results
        })

    } catch (err) {
        console.error(err)

        return res.status(400).json({
            message: 'Failed to get student results',
            error: err.message
        })
    }
})

router.get('/student/stats', verifyToken, async (req, res) => {  
  try {
    const token = req.cookies.token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    const uid = decoded.id

    const stats = await getStudentExamStats(uid)

    return res.status(200).json({stats})
  } catch (err) {
    console.error(err)

    return res.status(400).json({
        message: 'Failed to get statistics',
        error: err.message
    })
  }
})

router.get('/student/subjectstrengths', verifyToken, async (req, res) => {  
  try {
    const token = req.cookies.token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    const uid = decoded.id

    const stats = await getStudentSubjectStrengths(uid)

    return res.status(200).json({stats})
  } catch (err) {
    console.error(err)

    return res.status(400).json({
        message: 'Failed to get statistics',
        error: err.message
    })
  }
})

router.get('/student/gradetrends', verifyToken, async (req, res) => {  
  try {
    const token = req.cookies.token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    const uid = decoded.id

    const trends = await getStudentGradeTrend(uid)

    return res.status(200).json({trends})
  } catch (err) {
    console.error(err)

    return res.status(400).json({
        message: 'Failed to get statistics',
        error: err.message
    })
  }
})

router.get('/student/taken-exams', verifyToken, async (req, res) => {
  try {
    const token = req.cookies.token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET)
    const uid = decoded.id

    const results = await getStudentTakenExamResults(uid)

    return res.status(200).json({results})
  } catch (err) {
    console.error(err)
    return res.status(500).json({
      message: 'Failed to retrieve taken exam results',
      error: err.message
    })
  }
})

router.get('/exams/with-answer-keys/count', verifyToken, async (req, res) => {
  try {
    const count = await getExamsWithAnswerKeysCount()

    return res.status(200).json({ count })
  } catch (err) {
    console.error(err)
    return res.status(500).json({
      message: 'Failed to retrieve count of exams with answer keys',
      error: err.message
    })
  }
})

router.get('/exams/average-score', verifyToken, async (req, res) => {
  try {
    const averageScore = await getOverallAverageScore()

    return res.status(200).json({
      averageScore
    })
  } catch (err) {
    console.error("Error fetching overall average score:", err)
    return res.status(500).json({
      message: 'Failed to retrieve overall average score',
      error: err.message
    })
  }
})

module.exports = router