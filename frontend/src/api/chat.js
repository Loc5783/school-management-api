import api from './axiosConfig';

export const getChatContacts = (params) => api.get('/chat/contacts', { params });
export const getConversations = (params) => api.get('/chat/conversations', { params });
export const getConversationById = (id) => api.get(`/chat/conversations/${id}`);
export const getUnreadChat = () => api.get('/chat/unread');
export const openConversation = (data) => api.post('/chat/conversations', data);
export const getChatMessages = (id, params) => api.get(`/chat/conversations/${id}/messages`, { params });
export const sendChatMessage = (id, body) => api.post(`/chat/conversations/${id}/messages`, { body });
export const updateChatMessage = (conversationId, messageId, body) => api.patch(`/chat/conversations/${conversationId}/messages/${messageId}`, { body });
export const deleteChatMessage = (conversationId, messageId) => api.delete(`/chat/conversations/${conversationId}/messages/${messageId}`);
export const markChatRead = (id, upTo) => api.patch(`/chat/conversations/${id}/read`, { upTo });
export const setChatArchived = (id, archived) => api.patch(`/chat/conversations/${id}/archive`, { archived });
