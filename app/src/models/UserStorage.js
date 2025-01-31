"use strict";

const db = require("../config/db");

class UserStorage {
  static getUserInfo(id) {
    return new Promise((resolve, reject) => {
      const query = "SELECT * FROM users WHERE id = ?;";
      db.query(query, [id], (err, data) => {
        if (err) reject(`${err}`);
        else resolve(data[0]);
      });
    });
  }

  static async save(userInfo) {
    return new Promise((resolve, reject) => {
      const query = "INSERT INTO users(id, name, psword, birth) VALUES(?, ?, ?, ?);";
      db.query(query, [userInfo.id, userInfo.name, userInfo.password, userInfo.birth], (err) => {
        if (err) reject(`${err}`);
        else resolve({ success: true });
      });
    });
  }

  static async newsession(userInfo) {
    return new Promise((resolve, reject) => {
      const query = "INSERT INTO chat_sessions (conversation_id, user_id, model_name) VALUES(?, ?, ?);";
      db.query(query, [UUID(), userInfo.id, 'gpt-4o-mini'], (err) => {
        if (err) reject(`${err}`);
        else resolve({ success: true });
      });
    });
  }

  static async savemessage(userInfo) {
    return new Promise((resolve, reject) => {
      const query = "INSERT INTO chat_messages (conversation_id, user_id, question_or_answer, message) VALUES(?, ?, ?, ?);";
      db.query(query, [userInfo.conversation_id, userInfo.id, userInfo.q_a, userInfo.message], (err) => {
        if (err) reject(`${err}`);
        else resolve({ success: true });
      });
    });
  }

  static async search_uid(userInfo) {
    return new Promise((resolve, reject) => {
      const query = "SELECT * FROM chat_messages WHERE user_id = ? ORDER BY date_time ASC;";
      db.query(query, [userInfo.id], (err, data) => {
        if (err) reject(`${err}`);
        else resolve(data[0]);
      });
    });
  }

  static async search_cid(userInfo) {
    return new Promise((resolve, reject) => {
      const query = "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY date_time ASC;";
      db.query(query, [userInfoid], (err, data) => {
        if (err) reject(`${err}`);
        else resolve(data[0]);
      });
    });
  }
}

module.exports = UserStorage;
