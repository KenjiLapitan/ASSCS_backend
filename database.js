import pg from 'pg'
import Pool from 'pg-pool'
import dotenv from 'dotenv'

dotenv.config()

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
})

pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack)
  }
  console.log('Connected to PostgreSQL successfully!')
  release()
})

export async function getUsers({page = 1,limit = 10,search = '',filter = 'all'} = {}){
    const offset = (page - 1) * limit
    const values = []
    let where = []
    let paramIndex = 1

    if(filter === 'all'){
        where.push(`UPPER(u.status::text) = 'ACTIVE'`)
    }
    if (filter === 'teachers') {
        where.push(`UPPER(u.role::text) = $${paramIndex++}`)
        values.push('TEACHER')
        where.push(`UPPER(u.status::text) = 'ACTIVE'`)
    } 
    else if (filter === 'students') {
        where.push(`UPPER(u.role::text) = $${paramIndex++}`)
        values.push('STUDENT')
        where.push(`UPPER(u.status::text) = 'ACTIVE'`)
    } 
    else if (filter === 'applicants') {
        where.push(`UPPER(u.role::text) = $${paramIndex++}`)
        values.push('APPLICANT')
        where.push(`UPPER(u.status::text) = 'ACTIVE'`)
    }
    else if (filter === 'pendings') {
        where.push(`UPPER(u.status::text) = 'PENDING'`)
    }
    else if (filter === 'inactive') {
        where.push(`UPPER(u.status::text) = 'INACTIVE'`)
    }

    if (search.trim()) {
        where.push(`(
            LOWER(ui.fname) LIKE $${paramIndex} OR
            LOWER(ui.lname) LIKE $${paramIndex} OR
            LOWER(CONCAT(ui.fname, ' ', ui.lname)) LIKE $${paramIndex} OR
            LOWER(u.email) LIKE $${paramIndex} OR
            CAST(ui.student_id AS TEXT) LIKE $${paramIndex}
        )`)
        values.push(`%${search.toLowerCase().trim()}%`)
        paramIndex++
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const dataQuery = `
        SELECT * FROM users_info ui
        JOIN users u ON u.uid = ui.uid
        ${whereClause}
        ORDER BY ui.uid
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `
    values.push(limit, offset)

    const countQuery = `
        SELECT COUNT(*) FROM users_info ui
        JOIN users u ON u.uid = ui.uid
        ${whereClause}
    `

    const [dataResult, countResult] = await Promise.all([
        pool.query(dataQuery, values),
        pool.query(countQuery, values.slice(0, -2)) // remove limit & offset
    ])

    const total = parseInt(countResult.rows[0].count, 10)

    return {
        data: dataResult.rows,
        pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
        }
    }
}

export async function registerUser(fname,mname,lname,course,role,phone,email,password,status){     
    const conn = await pool.connect()

    let sid = null    
    let aid = null    
    
    try {
        if (role === 'STUDENT') {
            sid = await generateStudentId()
        }

        if (role === 'APPLICANT') {
            aid = await generateApplicantId()
        }

        await conn.query('BEGIN')

        const userResult = await conn.query(`
            INSERT INTO users(email, password, role, status) 
            VALUES ($1, $2, $3, $4) RETURNING uid`, 
            [email, password, role, status])

        const newUserId = userResult.rows[0].uid

        await conn.query(`
            INSERT INTO users_info(uid, fname, mname, lname, course, phone,student_id,applicant_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
            [newUserId, fname,mname,lname,course,phone,sid,aid])

        await conn.query('COMMIT')
    } catch (err) {
        await conn.query('ROLLBACK')
        throw err        
    } finally {
        conn.release()
    }
}

async function generateStudentId(){    
    const year = new Date().getFullYear()
    let result
    try {
        result = await pool.query(
        `
        SELECT student_id
        FROM users_info
        WHERE student_id >= $1 and student_id < $2
        ORDER BY student_id DESC
        LIMIT 1
        `,
        [year * 10000, (year + 1) * 10000]
    )
    } catch (error) {
        console.log(error)        
    }

    let sequence = 1

    if (result.rows.length > 0) {
        const lastStudentId = result.rows[0].student_id
        sequence = (lastStudentId % 10000) + 1
    }

    return year * 10000 + sequence
}

async function generateApplicantId() {
    const year = new Date().getFullYear()

    const prefix = Number(`8${year}`)       // 82026
    const startId = prefix * 10000 + 1      // 820260001
    const endId = prefix * 10000 + 9999     // 820269999

    let result

    try {
        result = await pool.query(
            `
            SELECT applicant_id
            FROM users_info
            WHERE applicant_id >= $1
              AND applicant_id <= $2
            ORDER BY applicant_id DESC
            LIMIT 1
            `,
            [startId, endId]
        )
    } catch (error) {
        console.log(error)
        throw error
    }

    let sequence = 1

    if (result.rows.length > 0) {
        const lastApplicantId = Number(result.rows[0].applicant_id)
        sequence = (lastApplicantId % 10000) + 1
    }

    return prefix * 10000 + sequence
}

export async function loginUser(user){    
    const result = await pool.query('SELECT * from public.users WHERE email = $1',[user])
    return result.rows
}

export async function getUserById(uid){    
    const result = await pool.query(`SELECT * FROM users_info ui JOIN users u ON u.uid=ui.uid WHERE u.uid = $1`,[uid])    
    return result.rows
}

export async function getTotalUsers(){
    const count = await pool.query(`SELECT
    COUNT(*) FILTER (WHERE role = 'STUDENT') AS student_count,
    COUNT(*) FILTER (WHERE role = 'TEACHER') AS teacher_count,
    COUNT(*) FILTER (WHERE role = 'APPLICANT') AS applicant_count,
    COUNT(*) AS total_count
    FROM users`)

    return count.rows
}

export async function editUser(query,values){
    const result = await pool.query(query, values)
    return result
}

export async function getChatConversationById(uid){    
    const result = await pool.query(`SELECT c.id,c.uid,c.title FROM conversations c WHERE c.uid = $1 ORDER BY created_at DESC`,[uid])    
    return result.rows
}

export async function getMessageById(id){    
    const result = await pool.query(`SELECT * FROM messages m WHERE m.conversation_id = $1 ORDER BY created_at ASC`,[id])    
    return result.rows
}

export async function createExam(subject, title, type, userId, numberOfItems){
    const code = await generateExamCode(subject, title, type)

    const result = await pool.query(
      `INSERT INTO exam(code, subject, title, type, created_by, total_items)
       VALUES ($1, $2, $3, $4, $5,$6)
       RETURNING *`,
      [code, subject, title, type, userId, numberOfItems]
    )

    return result
}

/*
    Generate exam code
    - Subject exam   → MATH-[YEAR]-0001
    - Entrance exam  → ENTRANCE-[YEAR]-0001
 */
async function generateExamCode(subject, title = "", type = "SUBJECT") {
  const year = new Date().getFullYear()

  let base

  // ===== ENTRANCE EXAM =====
  if (type === "ENTRANCE") {
    base = "ENTRANCE"
  } 
  // ===== SUBJECT EXAM =====
  else {
    // Create abbreviation from subject/title
    base = (subject || title || "EXAM")
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, "")
      .trim()
      .split(/\s+/)
      .map(word => word.slice(0, 3))
      .join("")
      .slice(0, 8)

    // Common overrides
    const commonMap = {
      'MATHEMATICS': "MATH",
      'MATH': "MATH",
      'ENGLISH': "ENG",
      'PHYSICS': "PHY",
      'CHEMISTRY': "CHEM",
      'BIOLOGY': "BIO",
      'SCIENCE': "SCI",
      'COMPUTER PROGRAMMING': "COMPROG",
      'APPLICATIONS DEVELOPEMENT': "APPSDEV",
    }

    const fullText = `${subject} ${title}`.toUpperCase()
    for (const [key, abbr] of Object.entries(commonMap)) {
      if (fullText.includes(key)) {
        base = abbr
        break
      }
    }
  }

  const prefix = `${base}${year}`   // e.g. MATH2025

  // ----- Get next sequential number -----
  const result = await pool.query(
    `
    SELECT code 
    FROM exam
    WHERE code LIKE $1
    ORDER BY code DESC
    LIMIT 1
    `,
    [`${prefix}%`]                 // matches MATH20250001, MATH20250002, ...
  )

  let nextNumber = 1

  if (result.rows.length > 0) {
    const lastCode = result.rows[0].code
    // Extract the last 4 digits
    const lastNumber = parseInt(lastCode.slice(-4), 10)
    nextNumber = lastNumber + 1
  }

  const numberPart = String(nextNumber).padStart(4, "0")

  return `${prefix}${numberPart}`   // MATH20250001
}

export async function getExams({
  page = 1,
  limit = 10,
  search = '',
  filter = 'all'
} = {}) {
  // Ensure numbers
  page  = Math.max(1, parseInt(page, 10) || 1);
  limit = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

  const offset = (page - 1) * limit;
  const values = [];
  const where  = [];
  let paramIndex = 1;

  // Search on title or subject
  if (search.trim()) {
    where.push(`(
      LOWER(e.title)   LIKE $${paramIndex} OR
      LOWER(e.subject) LIKE $${paramIndex}
    )`);
    values.push(`%${search.toLowerCase().trim()}%`);
    paramIndex++;
  }

  // Optional: add filter logic here later if needed
  // if (filter === 'with_key') { ... }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const dataQuery = `
    SELECT
      e.id,
      e.code,
      e.subject,
      e.title,
      e.type,
      e.created_by,
      e.created_at,
      e.total_items,
      ek.answers,
      CASE
        WHEN ek.id IS NULL THEN 'no answer key'
        ELSE 'has answer key'
      END AS status
    FROM exam e
    LEFT JOIN exam_answer_keys ek ON e.id = ek.exam_id
    ${whereClause}
    ORDER BY e.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  values.push(limit, offset);

  const countQuery = `
    SELECT COUNT(*)::int AS count
    FROM exam e
    LEFT JOIN exam_answer_keys ek ON e.id = ek.exam_id
    ${whereClause}
  `;

  const [dataResult, countResult] = await Promise.all([
    pool.query(dataQuery, values),
    pool.query(countQuery, values.slice(0, -2)) // remove limit & offset
  ]);

  const total = countResult.rows[0].count;

  return {
    data: dataResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1
    }
  };
}

export async function deleteExam(examId) {
  const conn = await pool.connect()

  try {
    await conn.query('BEGIN')

    // Delete answer key first (if exists)
    // await conn.query(
    //   `DELETE FROM exam_answer_keys WHERE exam_id = $1`,
    //   [examId]
    // )

    // Delete the exam
    const result = await conn.query(
      `DELETE FROM exam WHERE id = $1 RETURNING *`,
      [examId]
    )

    await conn.query('COMMIT')

    return result
  } catch (err) {
    await conn.query('ROLLBACK')
    throw err
  } finally {
    conn.release()
  }
}

export async function uploadAnswerKey(examId, answers) {
  const result = await pool.query(
    `
    INSERT INTO exam_answer_keys (exam_id, answers)
    VALUES ($1, $2)
    ON CONFLICT (exam_id) 
    DO UPDATE SET answers = EXCLUDED.answers
    RETURNING *
    `,
    [examId, JSON.stringify(answers)]
  )

  return result.rows[0]
}

export async function gradeAndSaveResult(examCode, studentId, studentAnswers) {
  const conn = await pool.connect()

  try {
    await conn.query('BEGIN')

    // Clean values
    const cleanExamCode = String(examCode).trim().toUpperCase()
    const cleanStudentId = String(studentId).trim()

    // 1. Find the exam + answer key
    const examResult = await conn.query(
      `
      SELECT 
        e.id,
        e.code,
        e.title,
        e.type,
        e.total_items,
        ek.answers
      FROM exam e
      LEFT JOIN exam_answer_keys ek 
        ON e.id = ek.exam_id
      WHERE UPPER(e.code) = $1
      `,
      [cleanExamCode]
    )

    if (examResult.rows.length === 0) {
      throw new Error(`Exam not found with code: ${examCode}`)
    }

    const exam = examResult.rows[0]

    if (!exam.answers) {
      throw new Error('This exam has no answer key yet')
    }

    // 2. Validate exam type and ID type

    const examType = String(exam.type).trim().toUpperCase()

    // Student ID:
    // 20260001
    // 20260002
    //
    // Applicant ID:
    // 820260001
    // 820260002

    const isStudentId = /^\d{8}$/.test(cleanStudentId)
    const isApplicantId = /^8\d{8}$/.test(cleanStudentId)

    if (examType === 'SUBJECT') {

      if (!isStudentId) {
        throw new Error(
          'This is a SUBJECT exam. Only students with a valid Student ID can take this exam.'
        )
      }

    } else if (examType === 'ENTRANCE') {

      if (!isApplicantId) {
        throw new Error(
          'This is an ENTRANCE exam. Only applicants with a valid Applicant ID can take this exam.'
        )
      }

    } else {
      throw new Error(`Invalid exam type: ${exam.type}`)
    }

    // 3. Handle answer key
    let officialAnswers = exam.answers

    if (typeof officialAnswers === 'string') {
      officialAnswers = JSON.parse(officialAnswers)
    }

    // 4. Grade the answers
    let correct = 0
    const details = []

    studentAnswers.forEach((item) => {
      const qIndex = item.question - 1

      const official = officialAnswers[qIndex] || null

      const studentAns = (item.answer || '?')
        .toUpperCase()
        .trim()

      const isCorrect =
        official &&
        studentAns === String(official).toUpperCase().trim()

      if (isCorrect) {
        correct++
      }

      details.push({
        question: item.question,
        studentAnswer: studentAns,
        correctAnswer: official || 'N/A',
        isCorrect
      })
    })

    // 5. Calculate score
    const total = officialAnswers.length

    const score =
      total > 0
        ? Math.round((correct / total) * 100)
        : 0

    // 6. Save / update result
    const saveResult = await conn.query(
      `
      INSERT INTO results (
        student_id,
        exam_id,
        answers,
        score
      )
      VALUES ($1, $2, $3, $4)

      ON CONFLICT (student_id, exam_id)
      DO UPDATE SET
        answers = EXCLUDED.answers,
        score = EXCLUDED.score

      RETURNING *
      `,
      [
        cleanStudentId,
        exam.id,
        JSON.stringify(studentAnswers),
        score
      ]
    )

    await conn.query('COMMIT')

    return {
      exam: {
        id: exam.id,
        code: exam.code,
        title: exam.title,
        type: exam.type,
        totalItems: total
      },

      studentId: cleanStudentId,
      correct,
      total,
      score,
      details,
      resultId: saveResult.rows[0].id
    }

  } catch (err) {

    await conn.query('ROLLBACK')
    throw err

  } finally {

    conn.release()

  }
}

export async function getStudentResults(id) {
  const cleanId = String(id).trim()

  const result = await pool.query(
    `
    SELECT
        r.id AS result_id,
        r.student_id,
        r.exam_id,
        r.score,
        r.answers,

        e.code AS exam_code,
        e.title AS exam_title,
        e.subject,
        e.type,
        e.total_items,
        e.created_at AS exam_date

    FROM results r

    JOIN exam e
        ON e.id = r.exam_id

    JOIN users_info ui
        ON (
            ui.student_id::text = r.student_id::text
            OR
            ui.applicant_id::text = r.student_id::text
        )

    WHERE
        ui.student_id::text = $1
        OR
        ui.applicant_id::text = $1

    ORDER BY e.created_at DESC
    `,
    [cleanId]
  )

  return result.rows
}

export async function getStudentExamStats(uid) {
    const result = await pool.query(
        `
        SELECT
            CASE
                WHEN ui.student_id IS NOT NULL
                    THEN ui.student_id::text
                WHEN ui.applicant_id IS NOT NULL
                    THEN ui.applicant_id::text
            END AS identifier
        FROM users_info ui
        WHERE ui.uid = $1
        `,
        [uid]
    )

    if (result.rows.length === 0) {
        throw new Error('User information not found')
    }

    const identifier = result.rows[0].identifier

    if (!identifier) {
        return {
            exam_count: 0,
            average_score: 0
        }
    }

    const stats = await pool.query(
        `
        SELECT
            COUNT(*)::int AS exam_count,
            COALESCE(ROUND(AVG(score), 2), 0) AS average_score
        FROM results
        WHERE student_id::text = $1
        `,
        [identifier]
    )

    return stats.rows[0]
}

export async function getStudentSubjectStrengths(uid) {
    const result = await pool.query(
        `
        SELECT
            subject,
            ROUND(AVG(score), 2) AS average_score
        FROM (
            SELECT
                e.subject,
                r.score,
                e.created_at
            FROM results r
            JOIN exam e
                ON e.id = r.exam_id
            JOIN users_info ui
                ON (
                    ui.student_id::text = r.student_id::text
                    OR
                    ui.applicant_id::text = r.student_id::text
                )
            WHERE ui.uid = $1
            ORDER BY e.created_at DESC
            LIMIT 3
        ) latest
        GROUP BY subject
        ORDER BY average_score DESC
        `,
        [uid]
    )

    return result.rows
}

export async function getStudentGradeTrend(uid) {
    const result = await pool.query(
        `
        SELECT
            e.id AS exam_id,
            e.subject,
            e.title AS exam_title,
            r.score,
            e.created_at AS exam_date
        FROM results r
        JOIN exam e
            ON e.id = r.exam_id
        JOIN users_info ui
            ON (
                ui.student_id::text = r.student_id::text
                OR
                ui.applicant_id::text = r.student_id::text
            )
        WHERE ui.uid = $1
        ORDER BY e.created_at DESC
        `,
        [uid]
    )

    return result.rows
}

export async function getStudentTakenExamResults(uid) {
  try {
    const result = await pool.query(
      `
      SELECT 
          r.id AS result_id,
          r.student_id,
          r.exam_id,
          r.score,
          r.answers AS student_answers,
          e.code AS exam_code,
          e.title AS exam_title,
          e.subject,
          e.type,
          e.total_items,
          e.created_at AS exam_date,
          ak.answers AS answer_key
      FROM users_info ui
      JOIN results r 
          ON ui.student_id::text = r.student_id::text 
          OR ui.applicant_id::text = r.student_id::text
      JOIN exam e 
          ON e.id = r.exam_id
      LEFT JOIN exam_answer_keys ak 
          ON e.id = ak.exam_id
      WHERE ui.uid = $1
      ORDER BY e.created_at DESC
      `,
      [uid]
    )

    return result.rows
  } catch (err) {
    console.error("Error executing getStudentTakenExamResults:", err)
    throw err
  }
}

export async function getExamsWithAnswerKeysCount() {
  const result = await pool.query(`
    SELECT COUNT(DISTINCT e.id)::int AS count
    FROM exam e
    INNER JOIN exam_answer_keys ek ON e.id = ek.exam_id
  `)

  return result.rows[0].count
}

export async function getOverallAverageScore() {
  const result = await pool.query(`
    SELECT COALESCE(ROUND(AVG(score), 2), 0) AS average_score
    FROM results
  `)

  return parseFloat(result.rows[0].average_score)
}

export default pool