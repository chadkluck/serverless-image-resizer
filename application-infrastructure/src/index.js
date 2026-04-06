console.log ("COLD START");

const answers = [ 
	"It is certain",
	"It is decidedly so",
	"Without a doubt",
	"Yes definitely",
	"You may rely on it",
	"As I see it, yes",
	"Most likely",
	"Outlook good",
	"Yes",
	"Signs point to yes",
	"Reply hazy try again",
	"Ask again later",
	"Better not tell you now",
	"Cannot predict now",
	"Concentrate and ask again",
	"Don't count on it",
	"My reply is no",
	"My sources say no",
	"Outlook not so good"
];

/**
 * This is the get function for your application referred to in the SAM 
 * template. It should be kept simple and used as the handler for the 
 * request. Business logic should be put in processRequest()
 * 
 * @param {*} event 
 * @param {*} context 
 * @returns {{statusCode: number, body: string, headers: object}}
 */
exports.handler = async (event, context) => {

	let response = null;

    try {

        response = processRequest(event, context); // process the request and wait for the result        
    
	} catch (error) {
		// send error message and trace to CloudWatch logs
		console.error(`Error in 7G: ${error.message}`, error.stack);
        response = {
			statusCode: 500,
			body: JSON.stringify({ status: 500, message: 'Internal server error in 7G' }),
			headers: {'content-type': 'application/json'}
		};
    } finally {
		return response; // Return the response directly instead of using callback
	}	
};

/**
 * Process the request
 * 
 * @param {object} event The event passed to the lambda function
 * @param {object} context The context passed to the lambda function
 * @returns {object} Response to send up to AWS API Gateway
 */
const processRequest = function(event, context) {
	
	const rand = Math.floor(Math.random() * answers.length);
	const prediction = answers[rand];
			
	// Gets sent to CloudWatch logs. Check it out!
	console.log(`Prediction log: ${prediction}`);
	
	return {
		statusCode: 200,
		body: JSON.stringify( { prediction } ),
		headers: {'content-type': 'application/json'}
	};

};